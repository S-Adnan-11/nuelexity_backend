import { expect, test } from "vitest";
import { AnswerSections, FOLLOW_UP_MARKER, validateFollowUps } from "../lib/follow-ups.js";
import type { Message, Source } from "../lib/types.js";

const sources: Source[] = [{id:1,title:"RSA key generation",url:"https://example.test/rsa",snippet:"RSA key generation uses prime factors. Factoring the modulus reveals the private key."}];
const query = "What is the mathematics behind RSA?";
const answer = "RSA key generation uses primes and modular arithmetic [1].";
const candidates = [
  {question:"Can you walk me through RSA key generation with small numbers?",anchor:"key generation"},
  {question:"Why does RSA decryption recover the original message?",anchor:"RSA"},
  {question:"How does factoring the modulus help reveal the private key?",anchor:"private key"},
];
const footer = FOLLOW_UP_MARKER + JSON.stringify({questions:candidates});

test("answer/footer separation survives every split and individual character without leaking metadata", () => {
  const output = answer + '\n' + footer;
  for (let split=0;split<=output.length;split++) {
    const sections = new AnswerSections();
    const visible = sections.push(output.slice(0,split)) + sections.push(output.slice(split));
    expect(visible).toBe(answer+'\n');
    expect(sections.suggestions(query,visible,sources,[])).toEqual(candidates.map(item=>item.question));
  }
  const sections = new AnswerSections();
  expect([...output].map(char=>sections.push(char)).join('')).toBe(answer+'\n');
});

test("missing, partial, malformed, oversized and excess metadata safely omit suggestions", () => {
  for (const tail of ['', '<|nuelex', FOLLOW_UP_MARKER+'{', FOLLOW_UP_MARKER+'{"questions":"bad"}', FOLLOW_UP_MARKER+'x'.repeat(3000), FOLLOW_UP_MARKER+JSON.stringify({questions:[...candidates,candidates[0]]})]) {
    const sections=new AnswerSections();
    const visible=[...(answer+tail)].map(char=>sections.push(char)).join('');
    expect(visible).toBe(answer);
    expect(sections.suggestions(query,visible,sources,[])).toEqual([]);
  }
});

test("filters unrelated anchors, duplicates, prior questions, markup and generic filler without replacing them", () => {
  expect(validateFollowUps({questions:[candidates[0],candidates[0],{question:'What do football sources say about transfers?',anchor:'football'}]},query,answer,sources,[])).toEqual([candidates[0]!.question]);
  const history=[{role:'user',content:candidates[0]!.question,status:'complete'}] as Message[];
  expect(validateFollowUps({questions:[candidates[0],{question:'What other information can sources provide?',anchor:'sources'},{question:'Can <b>RSA</b> reveal anything?',anchor:'RSA'}]},query,answer,sources,history)).toEqual([]);
  expect(validateFollowUps({questions:candidates},query,answer,[],[])).toEqual([]);
  expect(validateFollowUps({questions:candidates},query,"There is insufficient evidence about RSA [1].",sources,[])).toEqual([]);
});

test("contextual examples change across topics, follow bounded multi-turn context and retain the user's language", () => {
  const french = [{question:'Comment les racines partagent-elles les nutriments ?',anchor:'racines'}, {question:'Comment comparer les réseaux mycorhiziens et les racines ?',anchor:'réseaux mycorhiziens'}];
  const context = [{role:'user',content:'Explique les réseaux mycorhiziens et les racines.',status:'complete'}] as Message[];
  const evidence=[{...sources[0]!,title:'Forêts',snippet:'Les réseaux mycorhiziens relient les racines.'}];
  const actual=validateFollowUps({questions:french},'Et les nutriments ?', 'Les nutriments passent entre racines via des réseaux mycorhiziens [1].',evidence,context);
  expect(actual).toEqual(french.map(item=>item.question));
  expect(actual.every(question=>!question.includes('RSA'))).toBe(true);
  const solar=[{question:'How does battery storage change solar power availability?',anchor:'battery storage'}];
  expect(validateFollowUps({questions:solar},'Compare solar and wind', 'Solar power and wind need battery storage [1].',sources,[])).toEqual([solar[0]!.question]);
});
