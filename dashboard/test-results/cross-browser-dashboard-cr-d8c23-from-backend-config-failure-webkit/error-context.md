# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cross-browser.spec.ts >> dashboard cross-browser smoke coverage >> renders the shell and recovers from backend config failure
- Location: tests/browser/cross-browser.spec.ts:4:3

# Error details

```
Error: browserType.launch: Executable doesn't exist at /Users/dc/Library/Caches/ms-playwright/webkit-2287/pw_run.sh
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     npx playwright install                                 ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
```