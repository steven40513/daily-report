const fs = require('fs');
const path = require('path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '202606300001_initial_schema.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const seedPath = path.join(__dirname, '..', 'supabase', 'seed', '202606300002_initial_company_project_user.sql');
const seedSql = fs.readFileSync(seedPath, 'utf8');
const crewFieldsMigrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '202607020004_work_logs_crew_fields.sql');
const crewFieldsSql = fs.readFileSync(crewFieldsMigrationPath, 'utf8');
const stoppagesMigrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '202607140001_stoppages_and_backfill.sql');
const stoppagesSql = fs.readFileSync(stoppagesMigrationPath, 'utf8');

const checks = [
  ['companies table', /create table public\.companies\s*\(/i],
  ['users table', /create table public\.users\s*\(/i],
  ['projects table', /create table public\.projects\s*\(/i],
  ['project_members table', /create table public\.project_members\s*\(/i],
  ['daily_reports table', /create table public\.daily_reports\s*\(/i],
  ['report_items table', /create table public\.report_items\s*\(/i],
  ['work_logs table', /create table public\.work_logs\s*\(/i],
  ['daily report unique project date', /unique\s*\(\s*project_id\s*,\s*report_date\s*\)/i],
  ['project members unique membership', /unique\s*\(\s*project_id\s*,\s*user_id\s*\)/i],
  ['report items unique identity', /unique\s*\(\s*report_id\s*,\s*item_type\s*,\s*category\s*,\s*name\s*\)/i],
  ['updated_at trigger function', /create or replace function public\.set_updated_at\(\)/i],
  ['current company helper', /create or replace function public\.current_company_id\(\)/i],
  ['company admin helper', /create or replace function public\.is_company_admin\(target_company_id uuid\)/i],
  ['project member helper', /create or replace function public\.is_project_member\(target_project_id uuid\)/i],
  ['project writer helper', /create or replace function public\.can_write_project\(target_project_id uuid\)/i],
  ['companies RLS enabled', /alter table public\.companies enable row level security/i],
  ['users RLS enabled', /alter table public\.users enable row level security/i],
  ['projects RLS enabled', /alter table public\.projects enable row level security/i],
  ['project_members RLS enabled', /alter table public\.project_members enable row level security/i],
  ['daily_reports RLS enabled', /alter table public\.daily_reports enable row level security/i],
  ['report_items RLS enabled', /alter table public\.report_items enable row level security/i],
  ['work_logs RLS enabled', /alter table public\.work_logs enable row level security/i],
  ['authenticated policies only', /to authenticated/i],
  ['explicit auth uid null checks', /auth\.uid\(\) is not null/i],
  ['daily report insert created by current user', /created_by = auth\.uid\(\)/i],
  ['subcontractor name required when marked', /has_subcontractor = false[\s\S]*length\(trim\(subcontractor_name\)\) > 0/i],
];

const failures = checks.filter(([, pattern]) => !pattern.test(sql));
const seedChecks = [
  ['seed has auth user placeholder', /REPLACE_WITH_AUTH_USER_UUID/i],
  ['seed upserts company', /upsert_company/i],
  ['seed upserts public user', /upsert_user/i],
  ['seed creates project', /upsert_project/i],
  ['seed creates membership', /upsert_membership/i],
  ['seed uses conflict for user', /on conflict \(id\) do update/i],
  ['seed uses conflict for membership', /on conflict \(project_id, user_id\) do update/i],
];
const seedFailures = seedChecks.filter(([, pattern]) => !pattern.test(seedSql));

const crewFieldsChecks = [
  ['work_logs crew_category column', /add column crew_category text/i],
  ['work_logs crew_subtype column', /add column crew_subtype text/i],
  ['work_logs headcount column', /add column headcount integer/i],
  ['headcount non-negative constraint', /headcount is null or headcount >= 0/i],
];
const crewFieldsFailures = crewFieldsChecks.filter(([, pattern]) => !pattern.test(crewFieldsSql));

const stoppagesChecks = [
  ['daily_reports backfilled column', /add column if not exists backfilled boolean not null default false/i],
  ['daily_reports backfilled_at column', /add column if not exists backfilled_at timestamptz/i],
  ['stoppages table', /create table if not exists public\.stoppages\s*\(/i],
  ['stoppages unique project date', /unique\s*\(\s*project_id\s*,\s*stoppage_date\s*\)/i],
  ['stoppages updated_at trigger', /create trigger set_stoppages_updated_at/i],
  ['stoppages RLS enabled', /alter table public\.stoppages enable row level security/i],
  ['stoppages select policy', /"stoppages_select_project_access"/i],
  ['stoppages insert policy', /"stoppages_insert_project_writer"/i],
  ['stoppages update policy', /"stoppages_update_project_writer"/i],
  ['stoppages delete policy', /"stoppages_delete_project_writer"/i],
];
const stoppagesFailures = stoppagesChecks.filter(([, pattern]) => !pattern.test(stoppagesSql));

if (failures.length > 0 || seedFailures.length > 0 || crewFieldsFailures.length > 0 || stoppagesFailures.length > 0) {
  console.error('Supabase schema validation failed:');
  failures.forEach(([name]) => console.error(`- ${name}`));
  seedFailures.forEach(([name]) => console.error(`- ${name}`));
  crewFieldsFailures.forEach(([name]) => console.error(`- ${name}`));
  stoppagesFailures.forEach(([name]) => console.error(`- ${name}`));
  process.exit(1);
}

const totalChecks = checks.length + seedChecks.length + crewFieldsChecks.length + stoppagesChecks.length;
console.log(`validate-supabase-schema: ${totalChecks}/${totalChecks} checks passed`);
