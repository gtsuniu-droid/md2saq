import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/** A textarea that grows to fit its content, so nothing is hidden behind a scrollbar. */
export default function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = props.value;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  return <textarea {...props} ref={ref} className={["autosize", props.className].filter(Boolean).join(" ")} />;
}
