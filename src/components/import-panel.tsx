import { useRef, useState } from "react";
import { Clock, Loader2, CheckCircle2, AlertCircle, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImportItem {
  id: string;
  name: string;
  status: "pending" | "loading" | "done" | "error";
  label?: string;
  error?: string;
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Generic drag-drop/file-picker import panel. Files are processed sequentially
// (not in parallel) — matches Thalae's own import flow so status updates render
// predictably one at a time rather than racing.
export function ImportPanel({
  accept,
  helpText,
  onProcessFile,
}: {
  accept: string;
  helpText: string;
  onProcessFile: (file: File) => Promise<string>;
}) {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function processFiles(fileList: FileList) {
    const files = Array.from(fileList);
    const news: ImportItem[] = files.map((f) => ({ id: uid(), name: f.name, status: "pending" }));
    setItems((p) => [...p, ...news]);
    for (let i = 0; i < files.length; i++) {
      const item = news[i];
      const file = files[i];
      setItems((p) => p.map((x) => (x.id === item.id ? { ...x, status: "loading" } : x)));
      try {
        const label = await onProcessFile(file);
        setItems((p) => p.map((x) => (x.id === item.id ? { ...x, status: "done", label } : x)));
      } catch (e) {
        setItems((p) =>
          p.map((x) =>
            x.id === item.id ? { ...x, status: "error", error: (e as Error).message } : x,
          ),
        );
      }
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
        }}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
          drag ? "border-accent bg-surface-2" : "border-border hover:bg-surface-2",
        )}
      >
        <Upload className="size-6 mx-auto text-muted-foreground" />
        <div className="text-sm mt-2">Dépose des fichiers ici ou clique pour parcourir</div>
        <div className="text-xs text-muted-foreground mt-1">{helpText}</div>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) processFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2.5 text-sm px-3 py-2 rounded-md bg-surface-2"
            >
              {item.status === "pending" && (
                <Clock className="size-4 text-muted-foreground shrink-0" />
              )}
              {item.status === "loading" && (
                <Loader2 className="size-4 text-accent shrink-0 animate-spin" />
              )}
              {item.status === "done" && <CheckCircle2 className="size-4 text-success shrink-0" />}
              {item.status === "error" && (
                <AlertCircle className="size-4 text-destructive shrink-0" />
              )}
              <span className="flex-1 truncate">{item.label || item.name}</span>
              {item.status === "error" && (
                <span className="text-xs text-destructive truncate max-w-[40%]" title={item.error}>
                  {item.error}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
