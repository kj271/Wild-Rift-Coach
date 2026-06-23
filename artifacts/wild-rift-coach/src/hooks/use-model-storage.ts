import { useState, useEffect } from "react";

export function useModelStorage() {
  const [model, setModel] = useState<string | null>(() => {
    return localStorage.getItem("wildrift_model");
  });

  useEffect(() => {
    if (model) {
      localStorage.setItem("wildrift_model", model);
    } else {
      localStorage.removeItem("wildrift_model");
    }
  }, [model]);

  return [model, setModel] as const;
}
