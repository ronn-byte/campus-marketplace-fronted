import { useCallback, useMemo, useState } from "react";
import BlockingOverlay from "../components/BlockingOverlay";
import FeedbackDialog from "../components/FeedbackDialog";
import { FeedbackContext } from "./feedbackContext";

export function FeedbackProvider({ children }) {
  const [feedback, setFeedback] = useState(null);
  const [blockingLabel, setBlockingLabel] = useState("");
  const dismissFeedback = useCallback(() => setFeedback(null), []);
  const showFeedback = useCallback((nextFeedback) => {
    setBlockingLabel("");
    setFeedback(nextFeedback);
  }, []);
  const value = useMemo(() => ({ showFeedback, dismissFeedback, setBlockingLabel }), [showFeedback, dismissFeedback]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {blockingLabel && (
        <BlockingOverlay label={blockingLabel} />
      )}
      <FeedbackDialog feedback={feedback} onDismiss={dismissFeedback} />
    </FeedbackContext.Provider>
  );
}
