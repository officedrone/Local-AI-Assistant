// src/static/prompts.ts

//
// Code Validation, Completion & Chat Prompts
//

/**
 * Calculate the maximum allowed <think> tokens based on context size.
 * Defaults to 4096 if contextSize is missing/invalid.
 * Uses 1/5 of context size, floored to an integer, with a minimum of 1.
 */
const getMaxThinkTokens = (contextSize?: number): number => {
  const safeContextSize =
    Number.isFinite(contextSize) && contextSize! > 0 ? contextSize! : 4096;
  return Math.max(1, Math.floor(safeContextSize / 5));
};

// ---------- Chat Prompt ----------
export const chatPrompt = (
  language: string,
  fileContext?: string,
  contextSize?: number
): string => {
  const maxThinkTokens = getMaxThinkTokens(contextSize);
  const approxWords = Math.floor(maxThinkTokens / 0.75);
  const approxSentences = Math.ceil(maxThinkTokens / 20);

  let prompt = `You are a helpful AI assistant that answers developer questions clearly and as concisely as possible. If providing code blocks, provide only relevant code blocks and not the full file unless the user requests the full file. The language in use is ${language}

When reasoning, you must use a <think>...</think> section:
- Limit this section to a maximum of ${maxThinkTokens} tokens (≈ ${approxWords} words, about ${approxSentences} sentences).
- If you reach this limit, immediately close the </think> tag and continue with your final answer.
- Never continue reasoning outside the <think> section.
- Do not repeat or rephrase ideas inside <think>.

After closing </think>, follow these instructions for your final answer:
- Answer clearly and concisely.
- Provide only relevant code blocks, not the full file unless explicitly requested.`;

  if (fileContext) {
    prompt += `\n\nHere is the current file context:\n${fileContext}`;
  }
  return prompt;
};

// ---------- Validation ----------
export const userValidationMessage = (
  code: string,
  language: string = 'plaintext'
): string => `
Validate this **${language}** code:

\`\`\`${language}
${code.trim()}
\`\`\`
`;

export const validationPrompt = (
  code: string,
  context?: string,
  language: string = 'plaintext',
  contextSize?: number
): string => {
  const maxThinkTokens = getMaxThinkTokens(contextSize);
  const approxWords = Math.floor(maxThinkTokens / 0.75);
  const approxSentences = Math.ceil(maxThinkTokens / 20);

  return `
You are a code validation assistant.

Validate the code snippet below for correctness and clarity. Reason what the code context purpose is and ensure the code snippet makes sense within the file context.

When reasoning, you must use a <think>...</think> section:
- Limit this section to a maximum of ${maxThinkTokens} tokens (≈ ${approxWords} words, about ${approxSentences} sentences).
- If you reach this limit, immediately close the </think> tag and continue with your final answer.
- Never continue reasoning outside the <think> section.
- Do not repeat or rephrase ideas inside <think>.

After closing </think>, follow these instructions for your final answer:
- If code is valid and makes sense in the context: briefly confirm the code is valid without including or repeating the file context code or the code block.
- If context is insufficient: provide best-practice completions (specific to ${language}).
- If issues exist:
  - Begin with: **"Here is the revised code (explanation to follow):"**
  - Share only the necessary revised part.
  - Explain changes with a numbered list. Be brief when providing explanations.

${context ? `Reference context:\n\`\`\`${language}\n${context.trim()}\n\`\`\`` : ''}

Code to validate:\n\`\`\`${language}\n${code.trim()}\n\`\`\`
`;
};

// ---------- Completion ----------
export const userCompletionMessage = (
  code: string,
  language: string = 'plaintext'
): string => `
Complete the following **${language}** code:

\`\`\`${language}
${code.trim()}
\`\`\`
`;

export const completionPrompt = (
  code: string,
  context?: string,
  language: string = 'plaintext',
  contextSize?: number
): string => {
  const maxThinkTokens = getMaxThinkTokens(contextSize);
  const approxWords = Math.floor(maxThinkTokens / 0.75);
  const approxSentences = Math.ceil(maxThinkTokens / 20);

  return `
You are a code generation assistant.

Complete the code snippet meaningfully using the context. Reason what the code context purpose is and ensure the code snippet makes sense within the file context. If the code snippet is a comment only, then build the code that the comment suggests. 

When reasoning, you must use a <think>...</think> section:
- Limit this section to a maximum of ${maxThinkTokens} tokens (≈ ${approxWords} words, about ${approxSentences} sentences).
- If you reach this limit, immediately close the </think> tag and continue with your final answer.
- Never continue reasoning outside the <think> section.
- Do not repeat or rephrase ideas inside <think>.

After closing </think>, follow these instructions for your final answer:
- If complete and makes sense in the context: say **"The snippet appears complete and optimal as-is given the current context."** without repeating code.
- If context is weak: offer best-practice examples for ${language}.
- If completion is needed:
  - Begin: **"Within the current file context..."**
  - Share only the non-matching addition.
  - Use bullet points to describe changes. Be brief when describing the changes.

${context ? `Reference context:\n\`\`\`${language}\n${context.trim()}\n\`\`\`` : ''}

Code to complete:\n\`\`\`${language}\n${code.trim()}\n\`\`\`
`;
};
