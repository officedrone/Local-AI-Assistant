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

/**
 * Utility: format one or more file contexts into a single string.
 */
export function formatFileContexts(
  contexts?: { uri: string; language: string; content: string }[]
): string | undefined {
  if (!contexts || contexts.length === 0) return undefined;
  return contexts
    .map(
      (f) =>
        `// File: ${f.uri}\n\`\`\`${f.language}\n${f.content.trim()}\n\`\`\``
    )
    .join('\n\n');
}

/**
 * Utility: format capabilities into a string for the system prompt.
 * Uses [LAIToolCall] ... [/LAIToolCall] tags to wrap JSON tool calls.
 */
export function formatCapabilities(
  capabilities: { [key: string]: boolean }
): string {
  const enabled = Object.entries(capabilities)
    .filter(([_, v]) => v)
    .map(([k]) => `- ${k}`)
    .join('\n');
  if (!enabled) {
    return 'You currently have no special capabilities enabled.';
  }
  return `
You currently have access to the following capabilities/tools:
${enabled}

When you want to use a capability, you must output ONLY a JSON object wrapped in [LAIToolCall] ... [/LAIToolCall] tags.
Do not use any other tag styles (such as <|channel|> or XML‑like tags).

For the editFile capability, the JSON MUST have this shape:
[LAIToolCall]
{
  "type": "editFile",
  "uri": "file:///absolute/path/to/file",
  "edits": [
    {
      "start": { "line": 0, "character": 0 },
      "end":   { "line": 0, "character": 0 },
      "newText": "# Added comment\\n"
    }
  ]
}
[/LAIToolCall]

Notes:
- VS Code positions are 0-based (line 0 = first line, character 0 = first column).
- Use "newText" as the key for inserted text.
- Do not invent other keys like range, text, filePath, or changes.
- Prefer emitting **multiple small edits** in the "edits" array rather than replacing the entire file.
- Each edit should cover only the minimal range necessary (e.g. one function, one comment).
- Preserve original indentation and spacing exactly when constructing "newText".
- Use spaces/tabs consistently with the surrounding file context.
- Do not collapse multiple lines into one.
- When replacing a statement, always replace the entire line (from character 0 to end of line).
- Do not try to surgically replace substrings inside a line unless explicitly asked.
- Only replace the whole file if absolutely unavoidable.
`.trim();
}


// ---------- Chat Prompt ----------
export const chatPrompt = (
  language: string,
  fileContexts?: { uri: string; language: string; content: string }[],
  contextSize?: number,
  capabilities: { [key: string]: boolean } = {}
): string => {
  const maxThinkTokens = getMaxThinkTokens(contextSize);
  const approxWords = Math.floor(maxThinkTokens / 0.75);
  const approxSentences = Math.ceil(maxThinkTokens / 20);

  let prompt = `You are a helpful AI assistant that answers developer questions clearly and as concisely as possible. If providing code blocks, provide only relevant code blocks and not the full file unless the user requests the full file. The language in use is ${language}
  
  ${formatCapabilities(capabilities)}

When reasoning, you must use a <think>...</think> section:
- Limit this section to a maximum of ${maxThinkTokens} tokens (≈ ${approxWords} words, about ${approxSentences} sentences).
- If you reach this limit, immediately close the </think> tag and continue with your final answer.
- Never continue reasoning outside the <think> section.
- Do not repeat or rephrase ideas inside <think>.

After closing </think>, follow these instructions for your final answer:
- Answer clearly and concisely.
- Provide only relevant code blocks, not the full file unless explicitly requested.`;

  // 🔑 Inject capabilities
  prompt += `\n\n${formatCapabilities(capabilities)}`;

  const formatted = formatFileContexts(fileContexts);
  if (formatted) {
    prompt += `\n\nHere are the current file contexts:\n${formatted}`;
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
  contexts?: { uri: string; language: string; content: string }[],
  language: string = 'plaintext',
  contextSize?: number,
  capabilities: { [key: string]: boolean } = {}
): string => {
  const maxThinkTokens = getMaxThinkTokens(contextSize);
  const approxWords = Math.floor(maxThinkTokens / 0.75);
  const approxSentences = Math.ceil(maxThinkTokens / 20);

  const formatted = formatFileContexts(contexts);

  return `
You are a code validation assistant.

${formatCapabilities(capabilities)}

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

${formatted ? `Reference contexts:\n${formatted}` : ''}

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
  contexts?: { uri: string; language: string; content: string }[],
  language: string = 'plaintext',
  contextSize?: number,
  capabilities: { [key: string]: boolean } = {}
): string => {
  const maxThinkTokens = getMaxThinkTokens(contextSize);
  const approxWords = Math.floor(maxThinkTokens / 0.75);
  const approxSentences = Math.ceil(maxThinkTokens / 20);

  const formatted = formatFileContexts(contexts);

  return `
You are a code generation assistant.

${formatCapabilities(capabilities)}

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

${formatted ? `Reference contexts:\n${formatted}` : ''}

Code to complete:\n\`\`\`${language}\n${code.trim()}\n\`\
`;
};
