# Oracle rubric — paperclip-kow-smoketest

Project-specific review focus:
- This is a SECURITY smoke test. The cardinal risk is a FALSE PASS: the test
  reports green while kow is actually leaking the real credential to the agent.
  Hunt for every way an assertion (A1-A6) could pass without the security
  property truly holding.
- Verify the credentialed path is genuinely hermetic (never leaves the guest).
- Verify teardown cannot leak a qemu process, disk image, or host port even on
  crash, and that nothing mutates host state outside the scratch dir.
- No real credentials, targets, or hostnames belong in test code — only fixtures.

IMPORTANT output constraint for `suggested_check`:
- Write suggested_check as PLAIN PROSE only. Do NOT include any of these
  characters: backtick, semicolon, pipe, dollar sign, ampersand, less-than,
  greater-than. Name commands in words, not as shell snippets. A single such
  character discards the entire review.
