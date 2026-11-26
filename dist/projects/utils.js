export function findProject(projects, projectId) {
    return projects.find((project) => project.projectId.toLowerCase() === projectId.toLowerCase());
}
// "Name, hostname (id)", or just the id when the project has no name or hostname.
export function describeProject(project) {
    const label = [project.name, project.hostname].filter((part) => !!part).join(", ");
    return label ? `${label} (${project.projectId})` : project.projectId;
}
export function describeProjectList(projects) {
    return projects.length > 0
        ? `Projects you can query: ${projects.map(describeProject).join("; ")}.`
        : "Your Clarity account has no accessible projects as an admin or member.";
}
