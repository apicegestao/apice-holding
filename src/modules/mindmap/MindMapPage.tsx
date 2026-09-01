// Mapa mental: tela para tirar a ideia da cabeça. Nós arrastáveis, hierarquia
// livre e um atalho para transformar qualquer nó em tarefa da empresa.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ClipboardList,
  Maximize2,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { supabase } from '../../core/lib/supabase'
import { useAuth } from '../../core/auth/AuthProvider'
import { useCompany } from '../../core/company/CompanyProvider'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  Field,
  Loading,
  Modal,
  PageHeader,
  Spinner,
  useToast,
} from '../../core/ui'
import type { MindMap, MindMapNode } from '../../core/types'

const NODE_WIDTH = 190
const NODE_HEIGHT = 62
const PALETTE = ['#0EA5E9', '#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#0F172A']

type Transform = { x: number; y: number; scale: number }

export default function MindMapPage() {
  const { company, canWrite } = useCompany()
  const { profile } = useAuth()
  const { notify } = useToast()

  const [maps, setMaps] = useState<MindMap[]>([])
  const [activeMapId, setActiveMapId] = useState<string | null>(null)
  const [nodes, setNodes] = useState<MindMapNode[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [transform, setTransform] = useState<Transform>({ x: 80, y: 80, scale: 1 })
  const [creatingMap, setCreatingMap] = useState(false)
  const [newMapTitle, setNewMapTitle] = useState('')
  const [removingMap, setRemovingMap] = useState<MindMap | null>(null)
  const [taskFor, setTaskFor] = useState<MindMapNode | null>(null)
  const [busy, setBusy] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const fittedMapRef = useRef<string | null>(null)
  const dragRef = useRef<
    | { kind: 'node'; id: string; offsetX: number; offsetY: number; moved: boolean }
    | { kind: 'canvas'; startX: number; startY: number; originX: number; originY: number }
    | null
  >(null)

  // ------------------------------------------------------------ carregamento
  const loadMaps = useCallback(async () => {
    const { data } = await supabase
      .from('mind_maps')
      .select('*')
      .eq('company_id', company.id)
      .order('updated_at', { ascending: false })

    const rows = (data as MindMap[]) ?? []
    setMaps(rows)
    setActiveMapId((current) => current ?? rows[0]?.id ?? null)
    setLoading(false)
  }, [company.id])

  const loadNodes = useCallback(async (mapId: string) => {
    const { data } = await supabase.from('mind_map_nodes').select('*').eq('map_id', mapId)
    setNodes((data as MindMapNode[]) ?? [])
  }, [])

  useEffect(() => {
    setLoading(true)
    setActiveMapId(null)
    setNodes([])
    void loadMaps()
  }, [loadMaps])

  useEffect(() => {
    if (activeMapId) void loadNodes(activeMapId)
    else setNodes([])
  }, [activeMapId, loadNodes])

  // ------------------------------------------------------------------ mapas
  const createMap = async () => {
    const title = newMapTitle.trim() || 'Novo mapa'
    setBusy(true)
    const { data, error } = await supabase
      .from('mind_maps')
      .insert({ company_id: company.id, title, created_by: profile?.id ?? null })
      .select()
      .single()
    setBusy(false)

    if (error || !data) {
      notify(error?.message ?? 'Não foi possível criar o mapa.', 'error')
      return
    }

    // Todo mapa nasce com um nó central para não abrir vazio.
    await supabase.from('mind_map_nodes').insert({
      map_id: data.id,
      company_id: company.id,
      label: title,
      color: PALETTE[0],
      position_x: 320,
      position_y: 220,
    })

    setCreatingMap(false)
    setNewMapTitle('')
    setActiveMapId(data.id)
    await loadMaps()
    await loadNodes(data.id)
    notify('Mapa criado.')
  }

  const removeMap = async () => {
    if (!removingMap) return
    setBusy(true)
    const { error } = await supabase.from('mind_maps').delete().eq('id', removingMap.id)
    setBusy(false)
    if (error) {
      notify(error.message, 'error')
      return
    }
    setRemovingMap(null)
    setActiveMapId(null)
    await loadMaps()
    notify('Mapa excluído.')
  }

  // -------------------------------------------------------------------- nós
  const patchNode = async (id: string, patch: Partial<MindMapNode>) => {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, ...patch } : node)))
    const { error } = await supabase.from('mind_map_nodes').update(patch).eq('id', id)
    if (error) notify(error.message, 'error')
  }

  const addNode = async (parent: MindMapNode | null) => {
    if (!activeMapId) return
    const siblings = nodes.filter((node) => node.parent_id === (parent?.id ?? null))
    const position = parent
      ? { x: parent.position_x + NODE_WIDTH + 70, y: parent.position_y + siblings.length * 84 }
      : { x: 320 + siblings.length * 30, y: 220 + siblings.length * 90 }

    const { data, error } = await supabase
      .from('mind_map_nodes')
      .insert({
        map_id: activeMapId,
        company_id: company.id,
        parent_id: parent?.id ?? null,
        label: 'Nova ideia',
        color: parent?.color ?? PALETTE[0],
        position_x: position.x,
        position_y: position.y,
      })
      .select()
      .single()

    if (error || !data) {
      notify(error?.message ?? 'Não foi possível criar o nó.', 'error')
      return
    }
    setNodes((current) => [...current, data as MindMapNode])
    setSelectedId(data.id)
  }

  const deleteNode = async (node: MindMapNode) => {
    const { error } = await supabase.from('mind_map_nodes').delete().eq('id', node.id)
    if (error) {
      notify(error.message, 'error')
      return
    }
    setSelectedId(null)
    if (activeMapId) await loadNodes(activeMapId)
  }

  // ------------------------------------------------------------- arrastar
  const toWorld = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (clientX - rect.left - transform.x) / transform.scale,
      y: (clientY - rect.top - transform.y) / transform.scale,
    }
  }

  const onNodePointerDown = (event: ReactPointerEvent, node: MindMapNode) => {
    if (!canWrite) return
    event.stopPropagation()
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
    const point = toWorld(event.clientX, event.clientY)
    dragRef.current = {
      kind: 'node',
      id: node.id,
      offsetX: point.x - node.position_x,
      offsetY: point.y - node.position_y,
      moved: false,
    }
    setSelectedId(node.id)
  }

  const onCanvasPointerDown = (event: ReactPointerEvent) => {
    dragRef.current = {
      kind: 'canvas',
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
    }
    setSelectedId(null)
  }

  const onPointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag) return

    if (drag.kind === 'canvas') {
      setTransform((current) => ({
        ...current,
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      }))
      return
    }

    const point = toWorld(event.clientX, event.clientY)
    drag.moved = true
    setNodes((current) =>
      current.map((node) =>
        node.id === drag.id
          ? { ...node, position_x: point.x - drag.offsetX, position_y: point.y - drag.offsetY }
          : node,
      ),
    )
  }

  const onPointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.kind !== 'node' || !drag.moved) return

    const node = nodes.find((item) => item.id === drag.id)
    if (!node) return
    void supabase
      .from('mind_map_nodes')
      .update({
        position_x: Math.round(node.position_x),
        position_y: Math.round(node.position_y),
      })
      .eq('id', node.id)
  }

  const fitToContent = useCallback((list: MindMapNode[] = nodes) => {
    if (!list.length) {
      setTransform({ x: 80, y: 80, scale: 1 })
      return
    }
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const minX = Math.min(...list.map((node) => node.position_x))
    const minY = Math.min(...list.map((node) => node.position_y))
    const maxX = Math.max(...list.map((node) => node.position_x)) + NODE_WIDTH
    const maxY = Math.max(...list.map((node) => node.position_y)) + NODE_HEIGHT
    const scale = Math.min(1.2, (rect.width - 80) / (maxX - minX), (rect.height - 80) / (maxY - minY))
    const safeScale = Number.isFinite(scale) && scale > 0.2 ? scale : 1
    setTransform({
      scale: safeScale,
      x: 40 - minX * safeScale,
      y: 40 - minY * safeScale,
    })
  }, [nodes])

  // Ao abrir um mapa, enquadra o conteúdo uma vez — senão o usuário cai
  // num canto do canvas e acha que o mapa está vazio.
  useEffect(() => {
    if (!activeMapId || !nodes.length) return
    if (fittedMapRef.current === activeMapId) return
    fittedMapRef.current = activeMapId
    fitToContent(nodes)
  }, [activeMapId, nodes, fitToContent])

  const selected = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId],
  )

  const edges = useMemo(
    () =>
      nodes
        .filter((node) => node.parent_id)
        .map((node) => {
          const parent = nodes.find((item) => item.id === node.parent_id)
          if (!parent) return null
          return {
            id: node.id,
            x1: parent.position_x + NODE_WIDTH / 2,
            y1: parent.position_y + NODE_HEIGHT / 2,
            x2: node.position_x + NODE_WIDTH / 2,
            y2: node.position_y + NODE_HEIGHT / 2,
            color: node.color,
          }
        })
        .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge)),
    [nodes],
  )

  if (loading) return <Loading />

  return (
    <div className="mx-auto flex max-w-7xl flex-col">
      <PageHeader
        title={`Mapa mental · ${company.name}`}
        subtitle="Arraste os nós, ramifique as ideias e transforme o que virou decisão em tarefa."
        actions={
          <>
            {maps.length > 0 && (
              <select
                className="input w-auto"
                value={activeMapId ?? ''}
                onChange={(event) => {
                  setActiveMapId(event.target.value)
                  setSelectedId(null)
                }}
              >
                {maps.map((map) => (
                  <option key={map.id} value={map.id}>
                    {map.title}
                  </option>
                ))}
              </select>
            )}
            {canWrite && (
              <button type="button" className="btn-primary" onClick={() => setCreatingMap(true)}>
                <Plus className="h-4 w-4" /> Novo mapa
              </button>
            )}
          </>
        }
      />

      {maps.length === 0 ? (
        <EmptyState
          title="Nenhum mapa ainda"
          description="Crie um mapa para despejar as ideias antes de organizá-las."
          action={
            canWrite && (
              <button type="button" className="btn-primary" onClick={() => setCreatingMap(true)}>
                <Plus className="h-4 w-4" /> Criar mapa
              </button>
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="card relative min-h-[560px] flex-1 overflow-hidden">
            <div className="absolute left-3 top-3 z-10 flex gap-1">
              <button
                type="button"
                className="btn-ghost px-2 py-1"
                onClick={() => setTransform((c) => ({ ...c, scale: Math.min(2, c.scale + 0.15) }))}
                aria-label="Aproximar"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-ghost px-2 py-1"
                onClick={() => setTransform((c) => ({ ...c, scale: Math.max(0.35, c.scale - 0.15) }))}
                aria-label="Afastar"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-ghost px-2 py-1"
                onClick={() => fitToContent()}
                aria-label="Enquadrar"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              {canWrite && (
                <button type="button" className="btn-ghost px-2 py-1" onClick={() => void addNode(null)}>
                  <Plus className="h-4 w-4" /> nó solto
                </button>
              )}
            </div>

            {canWrite && (
              <p className="absolute bottom-3 left-3 z-10 text-[11px] text-slate-400">
                Arraste o fundo para mover · arraste um nó para reposicionar
              </p>
            )}

            <div
              ref={viewportRef}
              className="h-full min-h-[560px] w-full cursor-grab touch-none select-none bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:20px_20px] active:cursor-grabbing"
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              <div
                className="relative h-0 w-0"
                style={{
                  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                  transformOrigin: '0 0',
                }}
              >
                <svg className="pointer-events-none absolute overflow-visible" width="1" height="1">
                  {edges.map((edge) => (
                    <path
                      key={edge.id}
                      d={`M ${edge.x1} ${edge.y1} C ${(edge.x1 + edge.x2) / 2} ${edge.y1}, ${(edge.x1 + edge.x2) / 2} ${edge.y2}, ${edge.x2} ${edge.y2}`}
                      stroke={edge.color}
                      strokeWidth={2}
                      fill="none"
                      opacity={0.45}
                    />
                  ))}
                </svg>

                {nodes.map((node) => (
                  <div
                    key={node.id}
                    onPointerDown={(event) => onNodePointerDown(event, node)}
                    className={`absolute rounded-xl border-2 bg-white px-3 py-2 shadow-card transition-shadow ${
                      selectedId === node.id ? 'ring-2 ring-offset-2' : ''
                    } ${canWrite ? 'cursor-move' : 'cursor-default'}`}
                    style={{
                      left: node.position_x,
                      top: node.position_y,
                      width: NODE_WIDTH,
                      minHeight: NODE_HEIGHT,
                      borderColor: node.color,
                    }}
                  >
                    <p className="text-sm font-medium leading-snug text-ink-900">{node.label}</p>
                    {node.notes && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{node.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ------------------------------------------------ painel do nó */}
          <aside className="w-full shrink-0 lg:w-72">
            {selected ? (
              <div className="card space-y-4 p-4">
                <Field label="Ideia">
                  <textarea
                    className="input min-h-16"
                    value={selected.label}
                    disabled={!canWrite}
                    onChange={(event) =>
                      setNodes((current) =>
                        current.map((node) =>
                          node.id === selected.id ? { ...node, label: event.target.value } : node,
                        ),
                      )
                    }
                    onBlur={(event) => void patchNode(selected.id, { label: event.target.value })}
                  />
                </Field>
                <Field label="Anotações">
                  <textarea
                    className="input min-h-20"
                    value={selected.notes ?? ''}
                    disabled={!canWrite}
                    onChange={(event) =>
                      setNodes((current) =>
                        current.map((node) =>
                          node.id === selected.id ? { ...node, notes: event.target.value } : node,
                        ),
                      )
                    }
                    onBlur={(event) =>
                      void patchNode(selected.id, { notes: event.target.value || null })
                    }
                  />
                </Field>
                <Field asGroup label="Cor">
                  <div className="flex flex-wrap gap-2">
                    {PALETTE.map((color) => (
                      <button
                        key={color}
                        type="button"
                        disabled={!canWrite}
                        onClick={() => void patchNode(selected.id, { color })}
                        className={`h-7 w-7 rounded-full border-2 ${
                          selected.color === color ? 'border-ink-900' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                        aria-label={`Cor ${color}`}
                      />
                    ))}
                  </div>
                </Field>

                {canWrite && (
                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      className="btn-ghost w-full"
                      onClick={() => void addNode(selected)}
                    >
                      <Plus className="h-4 w-4" /> Ramificar
                    </button>
                    <button
                      type="button"
                      className="btn-ghost w-full"
                      onClick={() => setTaskFor(selected)}
                    >
                      <ClipboardList className="h-4 w-4" /> Virar tarefa
                    </button>
                    <button
                      type="button"
                      className="btn-danger w-full"
                      onClick={() => void deleteNode(selected)}
                    >
                      <Trash2 className="h-4 w-4" /> Excluir nó
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="card p-4 text-sm text-slate-500">
                <p className="font-medium text-ink-900">Nenhum nó selecionado</p>
                <p className="mt-1">
                  Clique em um nó para editar o texto, mudar a cor, ramificar ou transformar em
                  tarefa.
                </p>
                <p className="mt-3">
                  <Badge>{nodes.length} nó(s) neste mapa</Badge>
                </p>
              </div>
            )}

            {canWrite && activeMapId && (
              <button
                type="button"
                className="mt-3 w-full text-xs text-rose-600 hover:underline"
                onClick={() => setRemovingMap(maps.find((map) => map.id === activeMapId) ?? null)}
              >
                Excluir este mapa
              </button>
            )}
          </aside>
        </div>
      )}

      <Modal
        open={creatingMap}
        title="Novo mapa mental"
        onClose={() => setCreatingMap(false)}
        width="max-w-md"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreatingMap(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void createMap()}>
              {busy && <Spinner />}
              Criar
            </button>
          </>
        }
      >
        <Field label="Título do mapa">
          <input
            className="input"
            autoFocus
            placeholder="Expansão 2027, Reestruturação comercial…"
            value={newMapTitle}
            onChange={(event) => setNewMapTitle(event.target.value)}
          />
        </Field>
      </Modal>

      {taskFor && (
        <NodeToTaskModal
          node={taskFor}
          companyId={company.id}
          createdBy={profile?.id ?? null}
          onClose={() => setTaskFor(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(removingMap)}
        title="Excluir mapa"
        danger
        busy={busy}
        confirmLabel="Excluir"
        message={
          <>
            Excluir <strong>{removingMap?.title}</strong> apaga todos os nós dele.
          </>
        }
        onConfirm={() => void removeMap()}
        onCancel={() => setRemovingMap(null)}
      />
    </div>
  )
}

// --------------------------------------------------------- nó vira tarefa
function NodeToTaskModal({
  node,
  companyId,
  createdBy,
  onClose,
}: {
  node: MindMapNode
  companyId: string
  createdBy: string | null
  onClose: () => void
}) {
  const { notify } = useToast()
  const [title, setTitle] = useState(node.label)
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const { error } = await supabase.from('tasks').insert({
      company_id: companyId,
      title: title.trim() || node.label,
      description: node.notes,
      due_date: dueDate || null,
      mind_map_node_id: node.id,
      created_by: createdBy,
    })
    setBusy(false)

    if (error) {
      notify(error.message, 'error')
      return
    }
    notify('Tarefa criada a partir do mapa.')
    onClose()
  }

  return (
    <Modal
      open
      title="Transformar em tarefa"
      description="A tarefa fica ligada a este nó do mapa."
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy && <Spinner />}
            Criar tarefa
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Título da tarefa">
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Prazo" hint="Você define responsável e lembrete na tela de Tarefas.">
          <input
            className="input"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}
