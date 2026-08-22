import { ActionError } from 'astro:actions';
import { getSecret } from 'astro:env/server';


export const sendToWebhook = async (webhookUrlVar: string, formName: string, formData: Record<string,any>) => {
  const fetchTimeout = 10000; //10 seconds
  const backoffDelta = 5000; //5 seconds
  const maxAttempts = 3;

  const body = {
    form: formName,
    ts: new Date().toISOString(),
    id: crypto.randomUUID(),
    data: formData,
  }
  console.log(JSON.stringify(body, null, 2));

  const webhookUrl = getSecret(webhookUrlVar);
  if (!webhookUrl) {
    console.error(`Form ${formName}: missing destination for submission, forgot to set ${webhookUrlVar}?`);
    throw new ActionError({code:"SERVICE_UNAVAILABLE", message: "Could not save submission, try again later."});
  }

  let ok = false;
  for (let attempt = 1; attempt <= maxAttempts && !ok; attempt++) {
    if (attempt > 1) {
      console.warn(`Form ${formName}: retrying send, attempt ${attempt} of ${maxAttempts}`);
      // delay before retrying (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt - 1) * backoffDelta));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      ok = response?.ok;
      if (!ok) {
        console.error(`Form ${formName}: bad response from webhook, [${response.status}] - ${response.statusText}`);
        console.error(`Body:\n${await response.text()}`);
      }
    } catch (err) {
      if (err === controller.signal.reason) {
        console.error(`Form ${formName}: validation timeout`);
      } else {
        console.error(`Form ${formName}: validation error: ${err}`);
      }
    }
    clearTimeout(timeoutId);
  }
  if (ok) {
    console.log(`Form ${formName}: successfully sent to webhook at ${webhookUrlVar}`);
  } else {
    throw new ActionError({code:"SERVICE_UNAVAILABLE", message: "Could not save submission, try again later."});
  }
}