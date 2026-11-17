import 'fake-indexeddb/auto'
import { afterEach, expect, it } from 'vitest'
import { ProjectSession } from './projectSession'
import { ProjectRepository, type WorkspaceSnapshot } from './projectRepository'
import { buildProject } from '../project'
import { defaultWorkspaceLayout } from '../workspaceLayout'

const repos: ProjectRepository[] = [], sessions: ProjectSession[] = []
const sample = (name: string): WorkspaceSnapshot => ({ project: buildProject({ name, basemap: 'osm', displayCrs: 'EPSG:4326', camera: null, bookmarks: [], layers: [], layout: { paper: 'A4', orientation: 'landscape', elements: [] }, workspaceLayout: defaultWorkspaceLayout() }), editSnapshots: {} })
afterEach(async () => { sessions.splice(0).forEach(session => session.stop()); await Promise.all(repos.splice(0).map(repo => repo.close())) })
it('migrates once, coalesces changes, archives before switching and restores the active project', async () => {
  const repo = new ProjectRepository(crypto.randomUUID()); repos.push(repo)
  let workspace = sample('legacy'), migrations = 0
  const session = new ProjectSession(repo, () => workspace, value => { workspace = value }, () => undefined); sessions.push(session)
  await session.initialize(async () => { migrations++; return workspace })
  const first = session.id
  workspace = sample('changed'); session.schedule(); workspace = sample('latest'); session.schedule()
  await session.flush()
  expect(session.revision).toBe(2)
  expect((await repo.load(first))?.snapshot.project.name).toBe('latest')
  await session.create(sample('second'))
  await session.open(first)
  expect(workspace.project.name).toBe('latest')
  const next = new ProjectSession(repo, () => workspace, value => { workspace = value }, () => undefined); sessions.push(next)
  await next.initialize(async () => { migrations++; return sample('wrong') })
  expect(migrations).toBe(1)
  expect(workspace.project.name).toBe('latest')
})
it('reports conflict and allows an explicit new copy without overwriting the newer project', async () => {
  const repo = new ProjectRepository(crypto.randomUUID()); repos.push(repo)
  let workspace = sample('initial')
  const statuses: string[] = []
  const session = new ProjectSession(repo, () => workspace, value => { workspace = value }, state => statuses.push(state)); sessions.push(session)
  await session.initialize(async () => workspace)
  const original = session.id
  await repo.save(original, sample('other tab'), 1)
  workspace = sample('my unsaved work'); session.schedule()
  await expect(session.flush()).rejects.toThrow('another tab')
  expect(statuses.at(-1)).toBe('error')
  await session.create(workspace, false)
  expect(session.id).not.toBe(original)
  expect((await repo.load(original))?.snapshot.project.name).toBe('other tab')
  expect((await repo.load(session.id))?.snapshot.project.name).toBe('my unsaved work')
  await expect(session.flush()).resolves.toBeUndefined()
})
it('does not restore or migrate after a cancelled initialization', async () => {
  const repo = new ProjectRepository(crypto.randomUUID()); repos.push(repo)
  let restored = false
  const session = new ProjectSession(repo, () => sample('blank'), () => { restored = true }, () => undefined)
  const pending = session.initialize(async () => sample('legacy'))
  session.stop(); await pending
  expect(restored).toBe(false)
  expect(await repo.list()).toEqual([])
})
it('opens a remaining project instead of migrating legacy data again after active-project deletion', async () => {
  const repo = new ProjectRepository(crypto.randomUUID()); repos.push(repo)
  let workspace = sample('legacy'), migrated = 0
  const make = () => { const session = new ProjectSession(repo, () => workspace, value => { workspace = value }, () => undefined); sessions.push(session); return session }
  const first = make()
  await first.initialize(async () => { migrated++; return workspace })
  const original = first.id
  await first.create(sample('another'))
  await repo.delete(first.id)
  const reopened = make()
  await reopened.initialize(async () => { migrated++; return sample('wrong') })
  expect(reopened.id).toBe(original)
  expect(migrated).toBe(1)
  await repo.delete(original)
  workspace = sample('blank')
  const empty = make()
  await empty.initialize(async () => { migrated++; return sample('wrong') })
  expect(migrated).toBe(1)
  expect(workspace.project.name).toBe('blank')
})
