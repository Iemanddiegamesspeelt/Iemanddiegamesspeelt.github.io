'use client';

import { useState } from 'react';
import { Flag, LoaderCircle, MessageCircle, Pencil, Reply, Send, Trash2 } from 'lucide-react';
import type { CommentRecord, ProfileRecord } from '../../lib/data/types';
import { Avatar } from '../ui/avatar';
import { formatDate } from '../../lib/utils';

type CommentView = CommentRecord & { author: ProfileRecord };

export function CommentSection({ macroId, initialComments, currentUserId }: { macroId: string; initialComments: CommentView[]; currentUserId: string | null }) {
  const [comments, setComments] = useState(initialComments);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/macros/${macroId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, parentId: replyTo }),
      });
      const data = await response.json() as { comment?: CommentView; error?: { message?: string } };
      if (!response.ok || !data.comment) throw new Error(data.error?.message ?? 'Could not post comment.');
      setComments((items) => [...items, data.comment!]);
      setBody('');
      setReplyTo(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not post comment.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const response = await fetch(`/api/comments/${id}`, { method: 'DELETE' });
    if (response.ok) setComments((items) => items.map((item) => item.id === id ? { ...item, state: 'deleted', body: '' } : item));
  }

  async function edit(id: string, current: string) {
    const next = window.prompt('Edit comment', current)?.trim();
    if (!next || next === current) return;
    const response = await fetch(`/api/comments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: next }) });
    if (response.ok) setComments((items) => items.map((item) => item.id === id ? { ...item, body: next, editedAt: new Date().toISOString() } : item));
  }

  async function report(id: string) {
    const response = await fetch(`/api/comments/${id}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'other' }) });
    if (!response.ok) setError('Could not report this comment.');
  }

  const roots = comments.filter((comment) => !comment.parentId);
  return (
    <section className="rounded-[26px] border border-white/[.075] bg-[#0e1118] p-5 sm:p-7">
      <h2 className="flex items-center gap-2 text-xl font-semibold"><MessageCircle className="h-5 w-5 text-violet-300" /> Comments <span className="text-sm font-normal text-zinc-600">{comments.filter((item) => item.state === 'visible').length}</span></h2>
      <div className="mt-5 flex gap-3">
        <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={3} placeholder={currentUserId ? (replyTo ? 'Write a reply…' : 'Join the discussion…') : 'Sign in to comment'} disabled={!currentUserId || busy} className="min-w-0 flex-1 resize-none rounded-xl border border-white/[.08] bg-[#11151d] p-3 text-sm outline-none placeholder:text-zinc-700 focus:border-violet-400/40 disabled:opacity-50" />
        <button type="button" onClick={() => void submit()} disabled={!currentUserId || busy || !body.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500 disabled:opacity-40" aria-label="Post comment">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
      </div>
      {replyTo && <button type="button" onClick={() => setReplyTo(null)} className="mt-2 text-[10px] text-violet-300">Cancel reply</button>}
      {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}

      <div className="mt-7 space-y-5">
        {roots.map((comment) => (
          <div key={comment.id}>
            <CommentItem comment={comment} own={comment.authorId === currentUserId} onReply={() => setReplyTo(comment.id)} onEdit={() => void edit(comment.id, comment.body)} onDelete={() => void remove(comment.id)} onReport={() => void report(comment.id)} />
            <div className="ml-8 mt-4 space-y-4 border-l border-white/[.07] pl-4 sm:ml-11">
              {comments.filter((reply) => reply.parentId === comment.id).map((reply) => <CommentItem key={reply.id} comment={reply} own={reply.authorId === currentUserId} onEdit={() => void edit(reply.id, reply.body)} onDelete={() => void remove(reply.id)} onReport={() => void report(reply.id)} />)}
            </div>
          </div>
        ))}
        {!roots.length && <p className="py-5 text-center text-sm text-zinc-600">No comments yet.</p>}
      </div>
    </section>
  );
}

function CommentItem({ comment, own, onReply, onEdit, onDelete, onReport }: { comment: CommentView; own: boolean; onReply?: () => void; onEdit: () => void; onDelete: () => void; onReport: () => void }) {
  return (
    <article className="flex gap-3">
      <Avatar initials={comment.author.initials} tone={comment.author.avatarTone} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs"><strong>{comment.author.displayName}</strong><span className="text-zinc-600">@{comment.author.username}</span><time className="text-zinc-700" dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>{comment.editedAt && <span className="text-zinc-700">edited</span>}</div>
        <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${comment.state === 'deleted' ? 'italic text-zinc-700' : 'text-zinc-400'}`}>{comment.state === 'deleted' ? 'Comment deleted' : comment.body}</p>
        {comment.state === 'visible' && <div className="mt-2 flex gap-3 text-[10px] text-zinc-600">{onReply && <button type="button" onClick={onReply} className="flex items-center gap-1 hover:text-white"><Reply className="h-3 w-3" /> Reply</button>}{own ? <><button type="button" onClick={onEdit} className="flex items-center gap-1 hover:text-white"><Pencil className="h-3 w-3" /> Edit</button><button type="button" onClick={onDelete} className="flex items-center gap-1 hover:text-rose-300"><Trash2 className="h-3 w-3" /> Delete</button></> : <button type="button" onClick={onReport} className="flex items-center gap-1 hover:text-amber-300"><Flag className="h-3 w-3" /> Report</button>}</div>}
      </div>
    </article>
  );
}
