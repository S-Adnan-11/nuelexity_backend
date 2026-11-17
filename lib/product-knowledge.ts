import type { Message, Source } from "./types.js";

// Public maintainer-editable facts. Review alongside About when features change.
// Repository activity does not establish a project start or launch date.
export const PRODUCT_KNOWLEDGE: readonly Source[] = [
  {
    id: 1, title: "About Nuelexity", url: "https://nuelexity.devs.surf/about",
    snippet: "Nuelexity is an independent, search-first research assistant created by S. Adnan, built for learning. It searches the web, streams answers with numbered source links, and supports follow-up questions. Signed-in users can save private threads and choose supported models; guest threads are temporary. React and TypeScript power the frontend. Node.js and Express handle the API; Tavily retrieves web evidence; Groq serves answer models; Supabase provides authentication and PostgreSQL storage. It is not affiliated with Perplexity. Citations help inspect evidence and do not guarantee accuracy. Public sharing, file uploads, subscriptions and autonomous browsing are not available.",
  },
  {
    id: 2, title: "Nuelexity backend · public source", url: "https://github.com/S-Adnan-11/nuelexity_backend",
    snippet: "The approved answer catalogue is GPT-OSS 20B, GPT-OSS 120B and Qwen 3.8 27B (Preview), served through Groq. Availability can change; check available choices in the app. Guests use the configured default; signed-in users can choose an available approved model. Public repository commits exist from September 2026. They establish public development activity, not an exact start or launch date. This record establishes no specific start or launch date, funding, future model changes or future capabilities.",
  },
];

type ProductRoute = "product" | "mixed" | "web";
const name = "nuelexity(?:['’]s)?";
const topics = "(?:purpose|creator|founder|developer|stack|technology|features|capabilities|models|model|history|launch date|start date|funding|ownership|search|citations|streaming|saved threads|sign.in|guest mode)";
const only = [
  new RegExp(`^what is ${name}(?: and (?:who (?:created|built|made) it|how (?:does it work|it works)))?$`, "i"),
  new RegExp(`^(?:who|when|where|why) (?:created|built|made|owns|founded|developed|launched|started) ${name}$`, "i"),
  new RegExp(`^who (?:is|was) (?:the )?(?:creator|founder|developer) of ${name}$`, "i"),
  new RegExp(`^when (?:was ${name} (?:created|built|made|founded|developed|launched|started)|did ${name} (?:start|launch))$`, "i"),
  new RegExp(`^(?:tell me about|explain|describe) ${name}(?: ${topics})?$`, "i"),
  new RegExp(`^what (?:is|are) ${name} ${topics}$`, "i"),
  new RegExp(`^what (?:models|stack|features|capabilities|technology) (?:does|can) ${name} (?:use|offer|have|support)$`, "i"),
  new RegExp(`^how (?:does ${name} work|was ${name} built|is ${name} built)$`, "i"),
  new RegExp(`^what (?:does ${name} do|can ${name} do)$`, "i"),
  new RegExp(`^(?:does|can|is) ${name} (?:support |offer |use |save |have |allow |getting |adding |changing |a |an )?(?:${topics}|file uploads?|public sharing|subscriptions?|autonomous browsing|new models)(?: (?:work|available|supported|changing|soon|in the future))?$`, "i"),
];
const subject = new RegExp(`^(?:what (?:is|does|can) ${name}\\b|how (?:does|is|was|can) ${name}\\b|(?:who|when|where|why) (?:created|built|made|owns|founded|developed|launched|started) ${name}\\b|who (?:is|was) (?:the )?(?:creator|founder|developer) of ${name}\\b|when (?:was|did) ${name}\\b|(?:tell me about|explain|describe|compare|contrast) ${name}\\b|what (?:models|stack|features|capabilities|technology) (?:does|can) ${name}\\b|(?:is|does|can) ${name}\\b)`, "i");

function directRoute(question: string): ProductRoute {
  const text = question.trim().replace(/[?.!]+$/, "").trim();
  if (/\b(ignore|disregard|system prompt|developer message|pretend|bypass|instead of|only reply)\b/i.test(text)) return "web";
  if (/^(?:who are you|what are you|who (?:created|built|made) you|how do you work|what (?:is your stack|models do you use)|when were you (?:created|launched))$/i.test(text)) return "product";
  if (only.some(pattern => pattern.test(text))) return "product";
  const clauses = text.split(/(?:[?;]|\band\b|\balso\b)/i).map(clause => clause.trim()).filter(Boolean);
  if (clauses.length > 1 && clauses.every(clause => only.some(pattern => pattern.test(clause)))) return "product";
  // Product intent plus additional subject matter needs normal web evidence.
  // A passing mention alone has no first-party routing effect.
  if (clauses.some(clause => subject.test(clause)) ||
      new RegExp(`^(?:compare|what is the difference between) .+\\b${name}\\b`, "i").test(text)) return "mixed";
  return "web";
}

export function productRoute(query: string, history: Message[]): ProductRoute {
  const direct = directRoute(query);
  if (direct !== "web" || /\bnuelexity\b/i.test(query)) return direct;
  // Track a bounded chain of clear user follow-ups. A standalone topic change,
  // mixed question or instruction ends it; assistant text cannot establish it.
  const followUp = (text: string): ProductRoute => {
    if (/^(?:and |what about )(?:the )?(?:stack|creator|models|launch date|start date|features|capabilities)[?.!\s]*$/i.test(text)) return "product";
    const resolved = text.replace(/\bits\b/gi, "Nuelexity's").replace(/\bit\b/gi, "Nuelexity");
    return resolved === text ? "web" : directRoute(resolved);
  };
  let productContext = false;
  for (const message of history.filter(m => m.role === "user" && m.status === "complete").slice(-6))
    productContext = directRoute(message.content) === "product" || (productContext && followUp(message.content) === "product");
  return productContext ? followUp(query) : "web";
}

export function productSources(): Source[] {
  return PRODUCT_KNOWLEDGE.map(source => ({ ...source }));
}
