//
// Code Validation & Completion Prompts
//

// User bubble for validation
export const userValidationMessage = (code: string): string => `
**Validate this code:**

\`\`\`js
${code.trim()}
\`\`\`
`;

//LLM Code Validation Prompt
export const validationPrompt = (code: string, context?: string): string => `
You are a code validation assistant.

Validate the snippet below for correctness and clarity. Reason what the code context purpose is and wnsure the code snippet makes sense within the file context.

- If code is valid makes sense in the context: briefly confirm without repeating the code. Do not include the context or repeat code.
- If context is insufficient: provide best-practice completions (for each matching language).
- If issues exist:
  - Begin with: **"Here is the revised code (explanation to follow):"**
  - Share only the necessary revised part.
  - Explain with a numbered list.

${context ? `Reference context:\n\`\`\`js\n${context.trim()}\n\`\`\`` : ''}

Code to validate:\n\`\`\`js\n${code.trim()}\n\`\`\`
`;



// User bubble for completion
export const userCompletionMessage = (code: string): string => `
**Complete the following code:**

\`\`\`js
${code.trim()}
\`\`\`
`;

// LLM prompt for completion
export const completionPrompt = (code: string, context?: string): string => `
You are a code generation assistant.

Complete the snippet meaningfully using the context. Only include what’s missing or modified.Reason what the code context purpose is and wnsure the code snippet makes sense within the file context.


- If complete and makes sense in the context: say **"The snippet appears complete and optimal as-is given the current context."** without repeating code.
- If context is weak: offer best-practice examples for matching languages.
- If completion is needed:
  - Begin: **"Within the current file context..."**
  - Share only the non-matching addition.
  - Use bullet points to describe changes.

${context ? `Reference context:\n\`\`\`js\n${context.trim()}\n\`\`\`` : ''}

Code to complete:\n\`\`\`js\n${code.trim()}\n\`\`\`
`;

