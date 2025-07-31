


# Local AI Assistant

A Visual Studio Code extension that connects to a local LLM (Large Language Model) API endpoint and provides code completion, validation, and query-via-chat functionality. Perfect for developers using private or offline models running on their workstation or on the local network.


## Requirements

- A running local LLM API endpoint such as [LM Studio](https://lmstudio.ai/), [Ollama](https://ollama.com/), [KoboldCpp](https://github.com/LostRuins/koboldcpp), or [Oobabooga](https://github.com/oobabooga/text-generation-webui/releases)
- Network access to said endpoint (localhost or LAN)
- VS Code version `1.90.0` or newer


---

## Features

### Idle Tooltip Suggestions  
Shows contextual tooltips when idle, including quick links and actions.

![Tooltip Demo](https://github.com/officedrone/Local-AI-Assistant/blob/main/media/readme-tooltip.gif)



### Auto-Complete Code  
Autocompletes the current line or selection using your configured LLM.

- Windows: `Ctrl + Shift + Alt + Enter`  
- macOS: `Cmd + Shift + Alt + Enter`  

![Complete Code Demo](https://github.com/officedrone/Local-AI-Assistant/blob/main/media/readme-complete-code.gif)



### Validate Code Block  
Checks and validates selected code (or entire file if nothing is selected).

- Windows: `Ctrl + Shift + Alt + V`  
- macOS: `Cmd + Shift + Alt + V`

![Validate Code Demo](https://github.com/officedrone/Local-AI-Assistant/blob/main/media/readme-validate-code.gif)



### Open Chat Panel  
Launches an interactive chat interface for general-purpose LLM interaction.

- Windows: `Ctrl + Shift + Alt + C`  
- macOS: `Cmd + Shift + Alt + C`



### Open Settings Panel  
Quickly access and configure settings like endpoint, model, and behavior.

- Trigger via command palette: `Local AI Assistant – Open Settings`

![Settings Demo](https://github.com/officedrone/Local-AI-Assistant/blob/main/media/readme-settings.gif)



### Set API Key
Store an API key securely for authenticated LLM endpoints.
NOTE: This setting VS Code secure secrets storage API and does **not** store the key in settings.json 

- Windows: `Ctrl + Shift + Alt + K`  
- macOS: `Cmd + Shift + Alt + K`



### Select LLM Model  
Pick a model from your configured service if required (e.g. Qwen, Mistral, etc).

- Windows: `Ctrl + Shift + Alt + M`  
- macOS: `Cmd + Shift + Alt + M`

---

## Extension Settings

Accessible via:
- The gear icon in the chat panel  
- Preferences → Settings → Extensions → Local AI Assistant

### Configuration Options

| Setting                               | Description                                                                 |
|---------------------------------------|-----------------------------------------------------------------------------|
| `localAIAssistant.endpoint`           | LLM API base URL (e.g. `http://localhost:1234/v1`)                         |
| `localAIAssistant.apiType`            | Select LLM type (`OpenAI`, `Ollama`)                                       |
| `localAIAssistant.apiAuthRequired`    | If enabled, prompts user to enter a secure API key                         |
| `localAIAssistant.model`              | Default model for completions and chat                                     |
| `localAIAssistant.includeFileContext` | Whether to send full file text during code requests                        |
| `localAIAssistant.idleTooltipDelay`   | Delay before showing idle tooltips (in milliseconds)                       |
| `localAIAssistant.enableExtensionTooltip` | Enables or disables the tooltip                               |

---

## Upcoming features

- Inline completion
- Status indicator for LLM service
- Right-click context menu
- Token limit/character warnings
- Smart usage/embedding of current file in context
- SSL Validation
---

## Known Issues

- Ollama support limited
- API Key is optional and usage applies to OpenAI-based back-ends only 
- Temporary freeze possible if endpoint is unreachable during stream
- Auto-scroll can be wonky

---

## Release Notes

### 0.0.1 – Initial Release

- Chat panel with markdown rendering and code streaming  
- Code validation command
- Code completion command  
- Idle-based tooltip with hover interaction  
- Configurable API endpoint 
- New secure API key setup command  
- Model selection interface  
- Extension settings panel command

---

## Author & Repository

**Author**: [officedrone](https://github.com/officedrone)  
**GitHub**: [github.com/officedrone/local-ai-assistant](https://github.com/officedrone/local-ai-assistant)  
**Issues**: [Report bugs or request features](https://github.com/officedrone/local-ai-assistant/issues)

---

## License

GNU GPL v3


## 3rd party markdown used in chat

[markdown-it.min.js](https://cdn.jsdelivr.net/npm/markdown-it/dist/markdown-it.min.js)
