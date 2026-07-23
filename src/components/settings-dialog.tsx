import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getSettings, saveSettings } from "@/lib/settings";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (open) setApiKey(getSettings().apiKey ?? "");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Paramètres</DialogTitle>
          <DialogDescription>
            Utilisée uniquement pour l'extraction assistée par IA lors de l'import — envoyée
            directement depuis ton navigateur à api.anthropic.com, jamais stockée ailleurs que dans
            ce navigateur.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">Clé API Anthropic</label>
          <Input
            type="password"
            placeholder="sk-ant-api03-…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          {apiKey && !apiKey.startsWith("sk-ant") && (
            <p className="text-xs text-warning-foreground">
              Ceci ne ressemble pas à une clé Anthropic (elle devrait commencer par « sk-ant »).
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              saveSettings({ ...getSettings(), apiKey: apiKey.trim() });
              onOpenChange(false);
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
