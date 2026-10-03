<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Expert training mode: training-vs-live matching lives in DB functions (booking_expert_mode_ok + broadcast/claim/assign checks); admin writes go through /api/public/training/* server routes calling service_role-only training_* SQL functions — why: new Supabase edge functions are blocked on this stack and the SQL functions keep each action atomic.
