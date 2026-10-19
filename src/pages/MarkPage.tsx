import { useParams } from "react-router";
import SetMarking from "../components/SetMarking";

/** Mark a set from History: the same paper layout, with the model answer and score under each answer. */
export default function MarkPage() {
  const { attemptId = "" } = useParams();
  return <SetMarking key={attemptId} attemptId={attemptId} />;
}
