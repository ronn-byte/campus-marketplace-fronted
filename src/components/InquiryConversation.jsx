import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "../services/apiClient";
import {
  getInquiryMessages,
  markInquiryMessagesRead,
  sendInquiryMessage,
} from "../services/listingService";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : dateFormatter.format(date);
}

function getConversationError(error) {
  const code = error.response?.data?.error?.code;
  if (code === "INQUIRY_CLOSED") {
    return "This inquiry is closed. New messages are unavailable.";
  }
  if (code === "INQUIRY_MESSAGE_LIMIT_REACHED") {
    return "You have reached the message limit for this inquiry.";
  }
  if (code === "INQUIRY_NOT_FOUND") {
    return "This conversation is unavailable.";
  }
  return getApiErrorMessage(error);
}

export default function InquiryConversation({
  listingId,
  inquiryId,
  onThreadUpdated,
}) {
  const onThreadUpdatedRef = useRef(onThreadUpdated);
  const [state, setState] = useState({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);

  onThreadUpdatedRef.current = onThreadUpdated;

  const notifyThreadUpdated = useCallback((thread) => {
    onThreadUpdatedRef.current?.({
      inquiryId,
      status: thread.status,
      unreadMessageCount: thread.unreadMessageCount,
    });
  }, [inquiryId]);

  const loadThread = useCallback(async () => {
    const thread = await getInquiryMessages(listingId, inquiryId);
    if (thread.unreadMessageCount > 0) {
      await markInquiryMessagesRead(listingId, inquiryId);
      return getInquiryMessages(listingId, inquiryId);
    }
    return thread;
  }, [inquiryId, listingId]);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    loadThread()
      .then((thread) => {
        if (!active) return;
        setState({ status: "success", thread });
        notifyThreadUpdated(thread);
      })
      .catch((error) => {
        if (active) setState({ status: "error", message: getConversationError(error) });
      });
    return () => { active = false; };
  }, [loadThread, notifyThreadUpdated]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSending || !draft.trim()) return;

    setIsSending(true);
    setState((current) => ({ ...current, error: "" }));
    try {
      await sendInquiryMessage(listingId, inquiryId, draft);
      setDraft("");
      const thread = await getInquiryMessages(listingId, inquiryId);
      setState({ status: "success", thread });
      notifyThreadUpdated(thread);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: getConversationError(error),
      }));
    } finally {
      setIsSending(false);
    }
  };

  if (state.status === "loading") {
    return <p className="muted" role="status">Loading conversation…</p>;
  }
  if (state.status === "error") {
    return <p className="form-alert" role="alert">{state.message}</p>;
  }

  const { thread } = state;
  const isClosed = thread.status === "CLOSED";
  const isAtLimit = thread.messageAllowance.remaining === 0;

  return (
    <div className="inquiry-conversation">
      {thread.messages.length === 0 ? (
        <p className="muted">No messages in this conversation yet.</p>
      ) : (
        <ol className="inquiry-conversation__messages" aria-label="Conversation messages">
          {thread.messages.map((message) => {
            const isOwnMessage = message.sender === thread.viewerRole;
            return (
              <li
                className={`inquiry-message${isOwnMessage ? " inquiry-message--own" : ""}`}
                key={message.id}
              >
                <div className="inquiry-message__heading">
                  <strong>{isOwnMessage ? "You" : message.sender === "BUYER" ? "Buyer" : "Seller"}</strong>
                  <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                </div>
                <p>{message.content}</p>
              </li>
            );
          })}
        </ol>
      )}
      {state.error && <p className="form-alert" role="alert">{state.error}</p>}
      {isClosed ? (
        <p className="workspace-unavailable" role="status">This inquiry is closed. You can still review its messages.</p>
      ) : isAtLimit ? (
        <p className="workspace-unavailable" role="status">You have used all {thread.messageAllowance.limit} messages available for this inquiry.</p>
      ) : (
        <form className="inquiry-conversation__form" onSubmit={handleSubmit}>
          <label htmlFor={`inquiry-message-${inquiryId}`}>Your message</label>
          <textarea
            id={`inquiry-message-${inquiryId}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={2000}
            rows={3}
            required
            disabled={isSending}
          />
          <div className="inquiry-conversation__actions">
            <span className="muted">{thread.messageAllowance.remaining} message{thread.messageAllowance.remaining === 1 ? "" : "s"} remaining</span>
            <button className="button button--small" type="submit" disabled={isSending || !draft.trim()}>
              {isSending ? "Sending…" : "Send message"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
