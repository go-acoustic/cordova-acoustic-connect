# CICD Checklist for New Development

- [ ] Github topics - github topics applied ?
- [ ] Gitihub Access - access to repository per team, with proper setup for maintainers
- [ ] Github Dependabot - dependabot alerts reviewed with team. Critcal, and High issues should be addressed
- [ ] Jenkins Pipeline - generic pipeline is used
- [ ] Artifactory - Packaged artifact for repeat deployment
- [ ] Unit Tests - Unit tests defined, and executed every build
- [ ] SonarQube - Meeting criteria for Acoustic Way profile, and failing if not reaching targets.   Minimize exclusions to the scans
- [ ] Jfrog Xray - Scan repository for vulnerabilities, Critical and High issues should be addressed
- [ ] Test Automation - Team needs to identify test automation to be used for validation to minimize manual testing. This could include smoke/bvt, integration, e2e tests. Test should be run on build, or deployment.  
- [ ] Environments - code should be deployed in DEV, SHAREDQA, STAGE, and PROD
- [ ] Promote / Rollback - need a rollback strategy if quality gate fails.  Deployment promotion is arrested on failure
- [ ] Notifications - Slack notifications to stakeholders on deployment
- [ ] Approvals - Determine if release process has requirements for manual deployment, use approval processes in tool to facilitate
- [ ] Release Notes - Do we have Release notes for this version including links to Jira issues, and other meta data to easily understand manifest of deployment?
- [ ] Monitoring / Alerting - Does this application have monitoring in place, and alerting to team or 24x7 NOC team as needed
- [ ] Feature flags - Does development process include feature flags to allow of separation of Deployment and Release?  Use LaunchDarkly
