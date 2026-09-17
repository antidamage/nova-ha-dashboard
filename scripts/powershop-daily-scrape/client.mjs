/**
 * The authenticated browser page: account context and GraphQL calls.
 *
 * Moved verbatim from `scripts/powershop-daily-scrape.mjs`, which stays the
 * entry point (`node /app/scripts/powershop-daily-scrape.mjs`).
 */



async function selectedAccountNumber(page) {
  return page.evaluate(() => localStorage.getItem("selectedAccountNumber")).catch(() => null);
}

export function findAccountContext(capturedResponses, selectedNumber) {
  const accounts = capturedResponses.flatMap((response) => {
    const viewerAccounts = response?.body?.data?.viewer?.accounts;
    const account = response?.body?.data?.account;
    return [
      ...(Array.isArray(viewerAccounts) ? viewerAccounts : []),
      ...(account && typeof account === "object" ? [account] : []),
    ];
  });
  const contexts = accounts.flatMap((account) => {
    const property = (Array.isArray(account?.properties) ? account.properties[0] : null) ?? account?.property;
    if (!account?.number || !property?.id) {
      return [];
    }
    return [{ accountNumber: account.number, propertyId: property.id }];
  });
  return contexts.find((context) => context.accountNumber === selectedNumber) ?? contexts[0] ?? null;
}

export async function waitForAccountContext(page, capturedResponses, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let selectedNumber = await selectedAccountNumber(page);
  while (Date.now() < deadline) {
    const context = findAccountContext(capturedResponses, selectedNumber);
    if (context) {
      return context;
    }
    await page.waitForTimeout(500);
    selectedNumber = selectedNumber ?? (await selectedAccountNumber(page));
  }
  return null;
}

export async function fetchAuthenticatedGraphql(page, operationName, query, variables) {
  return page.evaluate(
    async ({ operationName, query, variables }) => {
      const authKey = Object.keys(localStorage).find((key) => key.startsWith("firebase:authUser:"));
      const token = authKey ? JSON.parse(localStorage.getItem(authKey))?.stsTokenManager?.accessToken : null;
      const headers = { "content-type": "application/json" };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch(`https://api.powershop.nz/v1/graphql/?opName=${operationName}`, {
        body: JSON.stringify({ operationName, query, variables }),
        headers,
        method: "POST",
      });
      const contentType = response.headers.get("content-type") ?? "";
      let body = await response.text();
      try {
        body = JSON.parse(body);
      } catch {
        // Keep text responses as evidence for auth/API failures.
      }
      return {
        body,
        contentType,
        status: response.status,
        url: response.url,
      };
    },
    { operationName, query, variables },
  );
}

export async function loadPlaywright() {
  try {
    return await import("playwright-core");
  } catch {
    // Fall through to the full package if this is run outside the Nova Docker wrapper.
  }
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(`Playwright or playwright-core is required for live scraping: ${error instanceof Error ? error.message : String(error)}`);
  }
}
