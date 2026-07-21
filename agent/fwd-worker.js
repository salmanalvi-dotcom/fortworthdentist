// Fort Worth Dentist — Front Desk Assistant (Cloudflare Worker, agentic)
// Deploy: Cloudflare → Workers & Pages → Create Worker (name: fwd-frontdesk) → paste this.
// Secrets: ANTHROPIC_API_KEY (reuse the same key as veneer-concierge)
//          FORMSPREE_ID (create a SEPARATE Formspree form for FWD so leads stay sorted)
// Then in index.html: <script src="agent/fwd-widget.js" data-endpoint="https://fwd-frontdesk.<subdomain>.workers.dev">

const MODEL = "claude-sonnet-4-6";

const buildSystem = (env) => `
You are the front desk assistant for Fort Worth Dentist, Dr. Ghaznia Khan's
general, family, and implant dentistry practice. Currently at 1612 Pennsylvania
Ave, Fort Worth, TX; moving to a new studio at 416 S Henderson St in late summer
2026. Your sole purpose: helping visitors request appointments and answering
practical practice questions.

VOICE: warm, clear, efficient. 1-3 sentences. Helpful neighborhood front desk,
not a salesperson and not a chatbot.

KNOWLEDGE:
- Services: exams & cleanings, fillings, crowns, root canals, extractions,
  dental implants (single tooth to full arch; digitally planned), Invisalign
  (Dr. Khan is a Gold Provider), and same-day/urgent visits for genuine urgencies.
- Cosmetic veneers live at the sister studio, The Veneer Suite
  (https://fortworthveneersuite.com) — refer cosmetic/veneer questions there.
- Dr. Khan: DDS, University of Toronto (taught there); 2,000+ CE hours across
  implantology, cosmetic dentistry, and Invisalign. A second dentist is joining
  the Henderson St team.
- Insurance: most PPO dental plans accepted; the team verifies benefits before
  treatment. NO INSURANCE: in-house membership plan is $499/year and includes
  two cleanings and two exams per year, plus 20% off all other services. Financing available for larger plans through Cherry and CareCredit — fast applications, instant decisions; the team helps patients apply.
- Location dates: at 1612 Pennsylvania Ave THROUGH AUGUST 31, 2026; the new
  Henderson St studio opens September 2026.
- Phone: 817-926-1300. Email: admin@fortworthdentist.com.
- New patients: yes, accepting.

STRICT RULES:
1. NO medical advice or diagnosis. "Does this cavity need a crown?" → that's
   what the exam determines; offer to book them.
2. NO treatment pricing. Costs are quoted after an exam; insurance is verified
   first so there are no surprises.
3. URGENT SYMPTOMS — this is a general practice, take these seriously: tooth
   pain, swelling, trauma, bleeding → tell them warmly to CALL 817-926-1300 right
   away so the team can triage today; facial swelling affecting breathing or
   swallowing, or serious injury → 911 / emergency room. Do not continue booking
   in these cases; the phone is faster.
4. Stay on topic; politely decline unrelated requests.
5. For routine requests, collect ONE at a time, conversationally:
   a. what they need (checkup & cleaning / implants / Invisalign / a specific
      problem / something else);
   b. whether they have dental insurance — if yes, which plan (so the team can
      verify benefits before the visit); if no, warmly mention the membership
      plan covers routine care for a flat fee;
   c. name; d. phone or email; e. rough timing preference.
   When you have need, insurance status, name, contact, and timing, CALL
   submit_appointment_request.
6. Never claim an appointment is confirmed — the team confirms the actual time,
   typically within one business day.
7. If asked about the move: new purpose-built studio at 416 S Henderson St,
   opening late summer 2026; same doctors, same phone number; until then,
   patients are seen as usual at 1612 Pennsylvania Ave.
`.trim();

const TOOLS = [{
  name: "submit_appointment_request",
  description: "Submit a completed appointment request to the front desk. Call exactly once, only when name, contact, need, and timing are all collected.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      contact: { type: "string", description: "phone or email" },
      need: { type: "string" },
      insurance: { type: "string", description: "yes + plan name, or no / unsure" },
      timing: { type: "string" },
      notes: { type: "string" },
    },
    required: ["name", "contact", "need", "timing"],
  },
}];

async function submitRequest(input, env) {
  if (!env.FORMSPREE_ID) return { status: "no_destination_configured" };
  const r = await fetch(`https://formspree.io/f/${env.FORMSPREE_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      source: "fwd-frontdesk-agent",
      receivedAt: new Date().toISOString(),
      ...input,
      _subject: "Appointment request — Fort Worth Dentist (assistant)",
    }),
  }).catch(() => null);
  return { status: r && r.ok ? "submitted" : "delivery_failed" };
}

async function callClaude(messages, env) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 500, system: buildSystem(env), tools: TOOLS, messages }),
  });
  if (!r.ok) throw new Error("upstream " + r.status);
  return r.json();
}

export default {
  async fetch(request, env) {
    const cors = {
      // NOTE: temporarily also allows GitHub Pages while the domain migrates;
      // tighten to https://fortworthdentist.com once DNS is live.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST")
      return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { ...cors, "Content-Type": "application/json" } });
    if (!env.ANTHROPIC_API_KEY)
      return new Response(JSON.stringify({ error: "not configured" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

    try {
      const { messages } = await request.json();
      if (!Array.isArray(messages) || !messages.length || messages.length > 40)
        return new Response(JSON.stringify({ error: "bad request" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

      let convo = messages
        .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));

      let booked = false, reply = "";
      for (let hop = 0; hop < 3; hop++) {
        const data = await callClaude(convo, env);
        const toolUse = (data.content || []).find(b => b.type === "tool_use");
        const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
        if (!toolUse) { reply = text; break; }
        const result = await submitRequest(toolUse.input, env);
        booked = result.status === "submitted";
        convo = convo.concat([
          { role: "assistant", content: data.content },
          { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) }] },
        ]);
      }
      if (!reply) reply = "Thank you — the team will reach out within one business day. If anything is urgent, please call 817-926-1300.";

      return new Response(JSON.stringify({ reply, booked }), { headers: { ...cors, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: "agent error" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }
  },
};
