import { Package, UserRound } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export function NewRecordTypeDialog({ open, onOpenChange, onSelect }: {
  open: boolean
  onOpenChange(open: boolean): void
  onSelect(type: "VISIT" | "GOODS_DELIVERY"): void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yeni kayıt</DialogTitle>
          <DialogDescription>Oluşturmak istediğiniz kayıt türünü seçin.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          <TypeButton icon={<UserRound className="size-5" />} title="Ziyaret" onClick={() => onSelect("VISIT")} />
          <TypeButton icon={<Package className="size-5" />} title="Mal teslimatı" onClick={() => onSelect("GOODS_DELIVERY")} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TypeButton({ icon, title, onClick }: { icon: React.ReactNode; title: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">{icon}{title}</span>
    </button>
  )
}
