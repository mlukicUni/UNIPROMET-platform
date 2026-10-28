import { Router, Request, Response } from 'express';
import { 
  getAllScheduledServices, 
  getScheduledServiceById, 
  createScheduledService, 
  updateScheduledService, 
  updateServiceTimes, 
  updateServiceRecipients,
  toggleServiceEnabled, 
  deleteScheduledService 
} from '../db/scheduledServicesDb';
import { runServiceNow } from '../services/unifiedSchedulerManager';

export const schedulerRouter = Router();

// GET /api/scheduler/services - List all scheduled services
schedulerRouter.get('/services', (_req: Request, res: Response) => {
  try {
    const services = getAllScheduledServices();
    const now = new Date();
    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    res.json({
      success: true,
      services,
      serverTime: now.toLocaleTimeString('sr-RS'),
      isWeekend,
      totalCount: services.length,
      activeCount: services.filter(s => s.is_enabled).length
    });
  } catch (err: any) {
    console.error('Error fetching scheduled services:', err);
    res.status(500).json({ error: 'Greška pri očitavanju servisa', details: err?.message });
  }
});

// GET /api/scheduler/services/:id - Get single scheduled service
schedulerRouter.get('/services/:id', (req: Request, res: Response) => {
  try {
    const service = getScheduledServiceById(req.params.id);
    if (!service) {
      return res.status(404).json({ error: 'Servis nije pronađen' });
    }
    res.json({ success: true, service });
  } catch (err: any) {
    res.status(500).json({ error: 'Greška pri očitavanju servisa', details: err?.message });
  }
});

// POST /api/scheduler/services - Create a new scheduled service
schedulerRouter.post('/services', (req: Request, res: Response) => {
  try {
    const { name, description, target_type, cron_times, weekdays_only, is_enabled, recipients } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Naziv servisa je obavezan' });
    }

    const newService = createScheduledService({
      name,
      description,
      target_type: target_type || 'custom',
      cron_times,
      weekdays_only,
      is_enabled,
      recipients
    });

    res.status(201).json({ success: true, service: newService });
  } catch (err: any) {
    console.error('Error creating scheduled service:', err);
    res.status(500).json({ error: 'Greška pri kreiranju servisa', details: err?.message });
  }
});

// PUT /api/scheduler/services/:id - Update service details (name, description, weekdays, recipients, etc.)
schedulerRouter.put('/services/:id', (req: Request, res: Response) => {
  try {
    const { name, description, target_type, cron_times, weekdays_only, is_enabled, recipients } = req.body;
    const updated = updateScheduledService(req.params.id, {
      name,
      description,
      target_type,
      cron_times,
      weekdays_only,
      is_enabled,
      recipients
    });

    if (!updated) {
      return res.status(404).json({ error: 'Servis nije pronađen' });
    }

    res.json({ success: true, service: updated });
  } catch (err: any) {
    console.error('Error updating scheduled service:', err);
    res.status(500).json({ error: 'Greška pri izmeni servisa', details: err?.message });
  }
});

// POST /api/scheduler/services/:id/times - Add or replace activation times
schedulerRouter.post('/services/:id/times', (req: Request, res: Response) => {
  try {
    const { time, times } = req.body;
    const service = getScheduledServiceById(req.params.id);
    if (!service) {
      return res.status(404).json({ error: 'Servis nije pronađen' });
    }

    let updatedTimes: string[] = [];

    if (Array.isArray(times)) {
      updatedTimes = times;
    } else if (time && typeof time === 'string') {
      const cleanTime = time.trim();
      if (!/^\d{1,2}:\d{2}$/.test(cleanTime)) {
        return res.status(400).json({ error: 'Vreme mora biti u formatu HH:MM (npr. 09:30)' });
      }
      const parts = cleanTime.split(':');
      const formatted = `${parts[0].padStart(2, '0')}:${parts[1]}`;
      updatedTimes = [...service.cron_times, formatted];
    } else {
      return res.status(400).json({ error: 'Morate navesti polje time ili times' });
    }

    const updated = updateServiceTimes(req.params.id, updatedTimes);
    res.json({ success: true, service: updated });
  } catch (err: any) {
    console.error('Error updating service times:', err);
    res.status(500).json({ error: 'Greška pri izmeni vremena aktivacije', details: err?.message });
  }
});

// DELETE /api/scheduler/services/:id/times/:time - Delete a single activation time
schedulerRouter.delete('/services/:id/times/:time', (req: Request, res: Response) => {
  try {
    const { id, time } = req.params;
    const service = getScheduledServiceById(id);
    if (!service) {
      return res.status(404).json({ error: 'Servis nije pronađen' });
    }

    const cleanTime = decodeURIComponent(time).trim();
    const remainingTimes = service.cron_times.filter(t => t !== cleanTime);

    const updated = updateServiceTimes(id, remainingTimes);
    res.json({ success: true, service: updated });
  } catch (err: any) {
    console.error('Error deleting service time:', err);
    res.status(500).json({ error: 'Greška pri brisanju vremena aktivacije', details: err?.message });
  }
});

// POST /api/scheduler/services/:id/recipients - Add a recipient or replace recipients list
schedulerRouter.post('/services/:id/recipients', (req: Request, res: Response) => {
  try {
    const { recipient, recipients, email } = req.body;
    const service = getScheduledServiceById(req.params.id);
    if (!service) {
      return res.status(404).json({ error: 'Servis nije pronađen' });
    }

    let updatedRecipients: string[] = [];

    if (Array.isArray(recipients)) {
      updatedRecipients = recipients;
    } else {
      const emailToAdd = (recipient || email || '').trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailToAdd || !emailRegex.test(emailToAdd)) {
        return res.status(400).json({ error: 'Unesite validnu email adresu (npr. korisnik@unipromet.co.rs)' });
      }

      if (service.recipients.includes(emailToAdd)) {
        return res.json({ success: true, service, message: 'Email adresa već postoji u listi' });
      }

      updatedRecipients = [...service.recipients, emailToAdd];
    }

    const updated = updateServiceRecipients(req.params.id, updatedRecipients);
    res.json({ success: true, service: updated });
  } catch (err: any) {
    console.error('Error adding service recipient:', err);
    res.status(500).json({ error: 'Greška pri dodavanju primaoca', details: err?.message });
  }
});

// DELETE /api/scheduler/services/:id/recipients/:recipient - Delete a single recipient
schedulerRouter.delete('/services/:id/recipients/:recipient', (req: Request, res: Response) => {
  try {
    const { id, recipient } = req.params;
    const service = getScheduledServiceById(id);
    if (!service) {
      return res.status(404).json({ error: 'Servis nije pronađen' });
    }

    const cleanEmail = decodeURIComponent(recipient).trim().toLowerCase();
    const remainingRecipients = service.recipients.filter(r => r.toLowerCase() !== cleanEmail);

    const updated = updateServiceRecipients(id, remainingRecipients);
    res.json({ success: true, service: updated });
  } catch (err: any) {
    console.error('Error deleting service recipient:', err);
    res.status(500).json({ error: 'Greška pri brisanju primaoca', details: err?.message });
  }
});

// PATCH /api/scheduler/services/:id/toggle - Toggle service enabled/disabled
schedulerRouter.patch('/services/:id/toggle', (req: Request, res: Response) => {
  try {
    const service = getScheduledServiceById(req.params.id);
    if (!service) {
      return res.status(404).json({ error: 'Servis nije pronađen' });
    }

    const newState = req.body?.is_enabled !== undefined ? !!req.body.is_enabled : !service.is_enabled;
    const updated = toggleServiceEnabled(req.params.id, newState);

    res.json({ success: true, service: updated });
  } catch (err: any) {
    console.error('Error toggling service state:', err);
    res.status(500).json({ error: 'Greška pri promeni stanja servisa', details: err?.message });
  }
});

// DELETE /api/scheduler/services/:id - Delete service
schedulerRouter.delete('/services/:id', (req: Request, res: Response) => {
  try {
    const success = deleteScheduledService(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Servis nije pronađen' });
    }
    res.json({ success: true, deletedId: req.params.id });
  } catch (err: any) {
    console.error('Error deleting scheduled service:', err);
    res.status(500).json({ error: 'Greška pri brisanju servisa', details: err?.message });
  }
});

// POST /api/scheduler/services/:id/run - Run service immediately (Run Now)
schedulerRouter.post('/services/:id/run', async (req: Request, res: Response) => {
  try {
    const result = await runServiceNow(req.params.id);
    res.json({ success: true, result });
  } catch (err: any) {
    console.error('Error running service manually:', err);
    res.status(500).json({ error: 'Greška pri ručnom pokretanju servisa', details: err?.message });
  }
});
