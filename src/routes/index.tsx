import { useCallback, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { db } from '@/db'
import { todos, type Todo } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'

const getTodos = createServerFn({ method: 'GET' }).handler(async () => {
  return db.select().from(todos).orderBy(desc(todos.createdAt))
})

const addTodo = createServerFn({ method: 'POST' })
  .inputValidator((d: string) => d)
  .handler(async ({ data }) => {
    await db.insert(todos).values({ text: data })
  })

const deleteTodo = createServerFn({ method: 'POST' })
  .inputValidator((d: number) => d)
  .handler(async ({ data }) => {
    await db.delete(todos).where(eq(todos.id, data))
  })

export const Route = createFileRoute('/')({
  component: Home,
  loader: () => getTodos(),
})

function Home() {
  const router = useRouter()
  const initialTodos = Route.useLoaderData()
  const [todoList, setTodoList] = useState<Todo[]>(initialTodos)
  const [newTodo, setNewTodo] = useState('')
  const [loading, setLoading] = useState(false)

  const handleAdd = useCallback(async () => {
    if (!newTodo.trim()) return
    setLoading(true)
    await addTodo({ data: newTodo })
    const updated = await getTodos()
    setTodoList(updated)
    setNewTodo('')
    setLoading(false)
    router.invalidate()
  }, [newTodo, router])

  const handleDelete = useCallback(
    async (id: number) => {
      setLoading(true)
      await deleteTodo({ data: id })
      const updated = await getTodos()
      setTodoList(updated)
      setLoading(false)
      router.invalidate()
    },
    [router],
  )

  return (
    <main style={{ maxWidth: 500, margin: '0 auto', padding: 20, fontFamily: 'system-ui' }}>
      <h1>Todos</h1>
      <p style={{ color: '#666', fontSize: 14 }}>TanStack Start + Neon Postgres</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          type="text"
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Add a todo..."
          disabled={loading}
          style={{ flex: 1, padding: 8, fontSize: 16 }}
        />
        <button onClick={handleAdd} disabled={loading || !newTodo.trim()} style={{ padding: '8px 16px' }}>
          Add
        </button>
      </div>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {todoList.map((todo) => (
          <li
            key={todo.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 0',
              borderBottom: '1px solid #eee',
            }}
          >
            <span>{todo.text}</span>
            <button
              onClick={() => handleDelete(todo.id)}
              disabled={loading}
              style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      {todoList.length === 0 && <p style={{ color: '#999', textAlign: 'center' }}>No todos yet</p>}
    </main>
  )
}
