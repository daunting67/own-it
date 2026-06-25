import bcrypt from 'bcryptjs'
import prisma from './lib/prisma.js'

async function seed() {
  console.log('Seeding database...')

  // Default admin user
  const existing = await prisma.user.findUnique({ where: { email: 'admin@ownit.co.nz' } })
  if (!existing) {
    const hash = await bcrypt.hash('changeme123', 10)
    await prisma.user.create({
      data: {
        email: 'admin@ownit.co.nz',
        name: 'Admin',
        password: hash,
        role: 'super_admin',
      }
    })
    console.log('Created admin user: admin@ownit.co.nz / changeme123')
  }

  // Default sites
  const siteCount = await prisma.site.count()
  if (siteCount === 0) {
    await prisma.site.createMany({
      data: [
        { name: 'Site A', inductions: ['Site safety walkthrough', 'Hazard register review'] },
        { name: 'Site B', inductions: ['Site safety walkthrough', 'Emergency procedures briefing'] },
      ]
    })
    console.log('Created default sites: Site A, Site B')
  }

  console.log('Seed complete.')
  await prisma.$disconnect()
}

seed().catch(e => { console.error(e); process.exit(1) })
