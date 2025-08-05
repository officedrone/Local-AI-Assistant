// src/static/prompts.ts

//
// Code Validation & Completion Prompts
//

// User bubble for validation
export const userValidationMessage = (code: string, language: string = 'plaintext'): string => `
Validate this **${language}** code:

\`\`\`${language}
${code.trim()}
\`\`\`
`;

// LLM Code Validation Prompt
export const validationPrompt = (
  code: string,
  context?: string,
  language: string = 'plaintext'
): string => `
You are a code validation assistant.

Validate the code snippet below for correctness and clarity. Reason what the code context purpose is and ensure the code snippet makes sense within the file context.

- If code is valid and makes sense in the context: briefly confirm without repeating the code. Do not include the context or repeat code.
- If context is insufficient: provide best-practice completions (specific to ${language}).
- If issues exist:
  - Begin with: **"Here is the revised code (explanation to follow):"**
  - Share only the necessary revised part.
  - Explain with a numbered list.

${context ? `Reference context:\n\`\`\`${language}\n${context.trim()}\n\`\`\`` : ''}

Code to validate:\n\`\`\`${language}\n${code.trim()}\n\`\`\`
`;

// User bubble for completion
export const userCompletionMessage = (code: string, language: string = 'plaintext'): string => `
Complete the following **${language}** code:

\`\`\`${language}
${code.trim()}
\`\`\`
`;

// LLM prompt for completion
export const completionPrompt = (
  code: string,
  context?: string,
  language: string = 'plaintext'
): string => `
You are a code generation assistant.

Complete the code snippet meaningfully using the context. Only include what’s missing or modified. Reason what the code context purpose is and ensure the code snippet makes sense within the file context. If the code snippet is a comment only, then build the code that the comment suggests.

- If complete and makes sense in the context: say **"The snippet appears complete and optimal as-is given the current context."** without repeating code.
- If context is weak: offer best-practice examples for ${language}.
- If completion is needed:
  - Begin: **"Within the current file context..."**
  - Share only the non-matching addition.
  - Use bullet points to describe changes.

${context ? `Reference context:\n\`\`\`${language}\n${context.trim()}\n\`\`\`` : ''}

Code to complete:\n\`\`\`${language}\n${code.trim()}\n\`\`\`
`;
