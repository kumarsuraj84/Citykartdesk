import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import { FolderKanban, LayoutGrid, Rows3 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { ExportButton } from '@/components/requests/ExportButton'
import { exportProjects } from '@/lib/actions/export'
import { getCurrentProfile, getAllProfiles } from '@/lib/queries/profiles'
import { getProjects, getProjectsProgress, getProjectStats, getAllTeamsMini, getLatestUpdateByProject } from '@/lib/queries/projects'
import { NewProjectPanel } from '@/components/projects/NewProjectPanel'
import { BulkUploadProjectsDialog } from '@/components/projects/BulkUploadProjectsDialog'
import { ProjectCard } from '@/components/projects/ProjectCard'
import { ProjectsTable } from '@/components/projects/ProjectsTable'
import { ProjectStatsCards } from '@/components/projects/ProjectStatsCards'
import { Pagination } from '@/components/ui/Pagination'
import { PROJECT_PRIORITY_ORDER as PRIORITIES } from '@/components/projects/ProjectPriorityBadge'
import type { ProjectStatus, ProjectPriority } from '@/types'

const STATUSES: ProjectStatus[] = ['not_started', 'in_progress', 'blocked', 'done', 'cancelled']

interface PageProps {
  searchParams: Promise<{ layout?: string; page?: string; pageSize?: string; search?: string; status?: string; priority?: string; owner?: string }>
}

export default async function ProjectsPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const sp = await searchParams
  const layout: 'cards' | 'table' = sp.layout === 'cards' ? 'cards' : 'table'
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const rawPageSize = parseInt(sp.pageSize ?? '50', 10)
  const pageSize = [25, 50, 100].includes(rawPageSize) ? rawPageSize : 50
  const search = sp.search?.trim() || undefined
  const status = STATUSES.includes(sp.status as ProjectStatus) ? (sp.status as ProjectStatus) : undefined
  const priority = PRIORITIES.includes(sp.priority as ProjectPriority) ? (sp.priority as ProjectPriority) : undefined
  const ownerId = sp.owner?.trim() || undefined

  const projectsPromise = getProjects({ page, pageSize, search, status, priority, ownerId })
  const latestUpdateByProjectPromise = getLatestUpdateByProject()

  const [result, progressByProject, profiles, teams, latestUpdateByProject, stats] = await Promise.all([
    projectsPromise,
    projectsPromise.then((r) => getProjectsProgress(r.data.map((p) => p.id))),
    getAllProfiles(),
    getAllTeamsMini(),
    latestUpdateByProjectPromise,
    latestUpdateByProjectPromise.then((u) => getProjectStats(u)),
  ])

  const projects = result.data

  // Only the true zero-projects-in-the-org state gets the onboarding empty
  // state — a search/filter that matches nothing keeps the controls visible
  // so the user can adjust them, instead of looking like there's no data at all.
  const hasActiveFilter = !!(search || status || priority || ownerId)
  const orgHasNoProjects = result.total === 0 && !hasActiveFilter

  return (
    <div className="space-y-3">
      <PageHeader
        title="Projects"
        description="Multi-week initiatives — group requests and tasks into one place to track progress."
        actions={
          <div className="flex items-center gap-2">
            <ExportButton action={exportProjects} filename="projects.csv" />
            <BulkUploadProjectsDialog />
            <NewProjectPanel profiles={profiles} teams={teams} currentUserId={profile.id} />
          </div>
        }
      />

      {!orgHasNoProjects && <ProjectStatsCards stats={stats} />}

      {orgHasNoProjects ? (
        <div className="rounded-lg border border-[#E8E8F0] bg-white">
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create a project to group requests and tasks that span more than one ticket."
          />
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5">
              <Link
                href="/projects?layout=cards"
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all ${
                  layout === 'cards' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Cards
              </Link>
              <Link
                href="/projects"
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all ${
                  layout === 'table' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Rows3 className="h-3.5 w-3.5" />
                Table
              </Link>
            </div>
          </div>

          {layout === 'table' ? (
            <ProjectsTable
              projects={projects}
              progressByProject={progressByProject}
              latestUpdateByProject={latestUpdateByProject}
              profiles={profiles}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} progress={progressByProject[project.id]} profiles={profiles} />
              ))}
            </div>
          )}

          <Suspense>
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              total={result.total}
              pageSize={result.pageSize}
              basePath="/projects"
              currentParams={{ layout }}
            />
          </Suspense>
        </>
      )}
    </div>
  )
}
