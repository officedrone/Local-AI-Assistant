// /src/static/webviewScripts/serviceStatus.js
export function updateServiceStatus(status) {
  const indicator = document.getElementById('api-status');
  const urlSpan = document.getElementById('llmURLBox');
  const apiTypeSpan = document.getElementById('apiTypeBox');
  const modelSpan = document.getElementById('modelNameBox');
  if (!indicator || !urlSpan || !apiTypeSpan || !modelSpan) return;

  const softRed = '#d66';
  const softOrange = '#d68b00';
  const softGreen = '#2e8540';
  const currentUrl = urlSpan.textContent.replace(/^URL:\s*/i, '').trim();
  const currentModel = modelSpan.textContent.replace(/^Model:\s*/, '').trim().toLowerCase();

  let modelIds = Array.isArray(status.models)
    ? status.models.map(m => typeof m === 'string' ? m.trim() : m?.id?.trim()).filter(Boolean)
    : Array.isArray(status.models?.data)
    ? status.models.data.map(m => m?.id?.trim()).filter(Boolean)
    : [];
  const normalizedIds = modelIds.map(id => id.toLowerCase());

  if (!currentUrl || currentUrl.toLowerCase() === 'none') {
    indicator.textContent = '🔌 Enter Service URL';
    indicator.style.color = softRed;
    urlSpan.style.color = softRed;
    apiTypeSpan.style.color = softRed;
    modelSpan.style.color = softRed;
  } else if (!status.serviceUp) {
    indicator.textContent = '🔌 Service Offline';
    indicator.style.color = softRed;
    urlSpan.style.color = softRed;
    apiTypeSpan.style.color = softRed;
    modelSpan.style.color = softRed;
  } else if (!status.hasModels) {
    indicator.textContent = '🚦 No models found for API type';
    indicator.style.color = softOrange;
    urlSpan.style.color = softGreen;
    apiTypeSpan.style.color = softOrange;
    modelSpan.style.color = softOrange;
  } else {
    urlSpan.style.color = softGreen;
    apiTypeSpan.style.color = softGreen;
    if (normalizedIds.includes(currentModel)) {
      indicator.textContent = '✅ Online';
      indicator.style.color = softGreen;
      modelSpan.style.color = softGreen;
    } else {
      indicator.textContent = '❌ Model mismatch';
      indicator.style.color = softOrange;
      modelSpan.style.color = softOrange;
      urlSpan.style.color = softGreen; // URL stays green for reachable service
    }
  }
}
