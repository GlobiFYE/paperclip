import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

for (const hasPlan of [false, true]) {
  test(`task reveals from its detail projection without waiting for a second plan request (plan=${hasPlan})`, async ({ page, request }) => {
    const companyResponse = await request.post("/api/companies", { data: { name: `Plan startup ${Date.now()}` } });
    expect(companyResponse.ok()).toBe(true);
    const company = await companyResponse.json();
    const issueResponse = await request.post(`/api/companies/${company.id}/issues`, { data: { title: "Read a saved conversation", status: "backlog" } });
    expect(issueResponse.ok()).toBe(true);
    const issue = await issueResponse.json();
    const commentResponse = await request.post(`/api/issues/${issue.id}/comments`, { data: { body: "This saved reply must be readable without a redundant plan request." } });
    expect(commentResponse.ok()).toBe(true);
    if (hasPlan) {
      const planResponse = await request.put(`/api/issues/${issue.id}/documents/plan`, { data: { format: "markdown", title: "Saved plan", body: "# Follow the saved plan\n\nKeep the conversation stable." } });
      expect(planResponse.ok()).toBe(true);
    }
    let planRequests = 0;
    await page.route("**/api/issues/*/documents/plan", async (route) => {
      planRequests += 1;
      await route.abort();
    });
    await page.goto(`/${company.issuePrefix}/issues/${issue.identifier}`);
    const thread = page.getByTestId("task-chat-thread");
    await expect(thread.locator(':scope > [aria-busy="false"]')).toBeVisible({ timeout: 10_000 });
    await expect(thread.getByText("This saved reply must be readable without a redundant plan request.", { exact: true })).toBeVisible();
    if (hasPlan) await expect(thread.getByTestId("task-chat-plan-preview")).toBeVisible();
    expect(planRequests).toBe(0);
  });
}
