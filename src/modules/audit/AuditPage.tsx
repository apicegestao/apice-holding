// Trilha de auditoria: quem fez o quê, quando.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../core/lib/supabase'
import { formatDateTime } from '../../core/lib/format'
import { useCompany } from '../../core/company/CompanyProvider'
import { Badge, Card, EmptyState, Loading, PageHeader } from '../../core/ui'
import type { AuditLog, Profile } from '../../core/types'

const ACTION_LABEL: Record<string, string> = {
  'user.created': 'criou o acesso',
  'user.linked': 'vinculou o usuário',
  'user.password_reset': 'resetou a senha',
  'user.activated': 'reativou o usuário',
  'user.deactivated': 'inativou o usuário',
  'user.role_changed': 'mudou o papel',
  'user.removed_from_company': 'removeu da empresa',
  'user.deleted': 'excluiu o cadastro',
  'user.super_admin_changed': 'alterou o admin da holding',
  'settings.updated': 'atualizou uma configuração',
}

function AuditTable({ logs, people }: { logs: AuditLog[]; people: Profile[] }) {
  if (logs.length === 0) {
    return <EmptyState title="Nada registrado ainda" />
  }

  const actorName = (id: string | null) =>
    id ? (people.find((person) => person.id === id)?.full_name ?? 'usuário removido') : 'sistema'

  return (
    <ul className="divide-y divide-line">
      {logs.map((log) => (
        <li key={log.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
          <span className="text-content-faint">{formatDateTime(log.created_at)}</span>
          <strong className="font-medium">{actorName(log.actor_id)}</strong>
          <span className="text-content-muted">{ACTION_LABEL[log.action] ?? log.action}</span>
          {log.entity_id && (
            <Badge>
              {log.entity}: {people.find((p) => p.id === log.entity_id)?.full_name ?? log.entity_id}
            </Badge>
          )}
        </li>
      ))}
    </ul>
  )
}

function CompanyAudit() {
  const { company, isAdmin } = useCompany()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: logRows }, { data: profileRows }] = await Promise.all([
      supabase
        .from('audit_logs')
        .select('*')
        .eq('company_id', company.id)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('profiles').select('*'),
    ])
    setLogs((logRows as AuditLog[]) ?? [])
    setPeople((profileRows as Profile[]) ?? [])
    setLoading(false)
  }, [company.id])

  useEffect(() => {
    void load()
  }, [load])

  if (!isAdmin) {
    return <EmptyState title="Área restrita" description="Só administradores desta empresa." />
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Auditoria · ${company.name}`} subtitle="Últimos 200 registros." />
      <Card>{loading ? <Loading /> : <AuditTable logs={logs} people={people} />}</Card>
    </div>
  )
}

function HoldingAudit() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [{ data: logRows }, { data: profileRows }] = await Promise.all([
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(300),
        supabase.from('profiles').select('*'),
      ])
      setLogs((logRows as AuditLog[]) ?? [])
      setPeople((profileRows as Profile[]) ?? [])
      setLoading(false)
    }
    void load()
  }, [])

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Auditoria do grupo" subtitle="Ações administrativas em todas as empresas." />
      <Card>{loading ? <Loading /> : <AuditTable logs={logs} people={people} />}</Card>
    </div>
  )
}

export default function AuditPage({ scope }: { scope: 'company' | 'holding' }) {
  return scope === 'company' ? <CompanyAudit /> : <HoldingAudit />
}
