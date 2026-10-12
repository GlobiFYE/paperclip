import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Send } from "lucide-react";
import type { SlackTestMessageResult } from "@paperclipai/shared";
import { chatEndpointsApi } from "@/api/chatEndpoints";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/queryKeys";

export function SlackTestMessageButton({ endpointId }: { endpointId: string }) {
  const queryClient = useQueryClient();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [accounts, setAccounts] = useState<Extract<SlackTestMessageResult, { status: "connection_required" }>["accounts"] | null>(null);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const send = useMutation({
    mutationFn: (slackUserId?: string) => chatEndpointsApi.sendSlackTestMessage(endpointId, { requestId, ...(slackUserId ? { slackUserId } : {}) }),
    onSuccess: (result) => {
      if (result.status === "connection_required") { setAccounts(result.accounts); return; }
      setAccounts(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.principals(endpointId) });
    },
  });
  const sent = send.data?.status === "sent";
  const reset = () => { setRequestId(crypto.randomUUID()); send.reset(); };
  return <div className="space-y-2">
      <Button variant="outline" disabled={send.isPending || sent} onClick={() => send.mutate(undefined)}>
        {send.isPending ? <Loader2 className="size-4 animate-spin" /> : sent ? <Check className="size-4" /> : <Send className="size-4" />}
        {send.isPending ? "Sending…" : sent ? "Test message sent" : "Send me a test message"}
      </Button>
    {send.isError && <div role="alert" className="max-w-sm text-sm text-destructive">
      {send.error.message} <button className="underline" onClick={reset}>Dismiss</button>
    </div>}
    <Dialog open={accounts !== null} onOpenChange={(open) => { if (!open && !send.isPending) setAccounts(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect your Slack account</DialogTitle>
          <DialogDescription>Choose your account. Messages to this agent will use your Paperclip permissions.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Find your Slack account" placeholder="Find your name" value={search} onChange={event => setSearch(event.target.value)} />
        <div className="max-h-64 space-y-1 overflow-y-auto" role="radiogroup" aria-label="Your Slack account">
          {accounts?.filter(account => `${account.name} ${account.id}`.toLowerCase().includes(search.toLowerCase())).map(account =>
            <label key={account.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 text-sm">
              <input type="radio" name="slack-account" value={account.id} checked={selected === account.id} onChange={() => setSelected(account.id)} />
              <span>{account.name} <span className="text-muted-foreground">({account.id})</span></span>
            </label>)}
          {accounts?.length === 0 && <p className="text-sm text-muted-foreground">No available accounts found in this Slack workspace.</p>}
        </div>
        {send.isError && <p role="alert" className="text-sm text-destructive">{send.error.message}</p>}
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" disabled={send.isPending} onClick={() => setAccounts(null)}>Cancel</Button>
          <Button disabled={!selected || send.isPending} onClick={() => send.mutate(selected)}>{send.isPending ? "Connecting…" : "This is my account — send message"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
