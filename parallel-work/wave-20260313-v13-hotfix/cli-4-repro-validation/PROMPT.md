You are working in `C:\gpt\01project\tire-store-re`.

Read these first:
- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\README.md`
- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-4-repro-validation\TASK.md`

Your role is the repro and validation worker.

Mission:
- Document the current visible issues before merge:
  - dashboard error banner still appears
  - Quick Sale still feels clipped on 1080p
  - customer lookup display should not use an inner scroll box
- Use the real DB at:
  `C:\Users\h19h2\AppData\Roaming\com.tirestore.desktop\tire-store.db`
- Avoid product code changes unless a tiny note/helper file is absolutely necessary under this wave folder.

Required output:
1. Write reproduction notes.
2. Reconfirm relevant DB facts when useful.
3. If practical after the other workers finish, run:
   - `npm run lint`
   - `npm run build`
   - `cargo test`
4. Write the final summary into:
   `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-4-repro-validation\RESULT.md`

`RESULT.md` format:
1. Reproduction notes
2. Real DB confirmation
3. Tests run
4. Final merge checklist notes
