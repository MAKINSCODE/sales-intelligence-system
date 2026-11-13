# Briefwell

**Turn inbound leads into verified, evidence-backed sales briefings.**

Briefwell is an AI-powered sales intelligence tool that helps sales and executive teams qualify inbound leads, verify identities, research prospects and prepare for first conversations.

## The problem

Preparing for a first conversation can mean hours of manual research: confirming who a lead is, understanding their company, assessing fit and finding a relevant way to approach them. The process is time-consuming, and unsupported or outdated information can lead teams in the wrong direction.

## How it works

1. **Qualifies leads** against business criteria such as professional email, company size, revenue and service fit—before resource-intensive research begins.
2. **Verifies identity** by finding possible matches and requesting human confirmation when a person's identity is uncertain.
3. **Researches prospects** using web search and LinkedIn data to gather relevant information about the person and their company.
4. **Generates a briefing** with the prospect's background, company context, decision-makers, business signals and potential opportunities. Users can refine the briefing with AI-assisted chat and export it as a PDF.

## Designed for Sales research

Briefwell does more than generate a summary. Every claim is labelled as a **fact**, **hypothesis** or **unavailable**, and linked to a supporting source quotation so users can check the evidence. Sources are collected before the briefing is generated, and uncertain identities pass through a human review step before deeper research begins.

The application uses a separate background worker and Redis queue for longer research tasks, keeping the web interface responsive. Configurable limits help control research time and API costs.

## Tech stack

- **Frontend:** Next.js, React, TypeScript, Tailwind CSS
- **Backend & data:** Node.js, PostgreSQL, Prisma, Redis, BullMQ
- **AI & research:** OpenAI API, Tavily, Apify
- **Validation & testing:** Zod, Vitest, Playwright
- **Infrastructure:** Docker

## Project status

Briefwell is a portfolio project that runs locally with Docker. It supports a no-cost demo mode using sample data and a live mode using external APIs. It is not currently deployed as a hosted service.
