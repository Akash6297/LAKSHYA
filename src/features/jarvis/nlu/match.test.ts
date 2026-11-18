import { describe, expect, it } from 'vitest'
import { autocorrect, spokenNumber } from './autocorrect'
import { phonetic, pickOption, planCall, type Contact } from './match'

const contacts: Contact[] = [
  { name: 'Mummy', numbers: [{ number: '+91 90000 00001', label: 'mobile' }] },
  { name: 'Papa', numbers: [{ number: '+91 90000 00002', label: 'mobile' }, { number: '0612 222222', label: 'work' }] },
  { name: 'Rahul Sharma', numbers: [{ number: '+91 90000 00003', label: 'mobile' }, { number: '+91 80000 00003', label: 'work' }] },
  { name: 'Rahul Verma', numbers: [{ number: '+91 90000 00004', label: 'mobile' }] },
  { name: 'Shreya Iyer', numbers: [{ number: '+91 90000 00005', label: 'mobile' }, { number: '+91 90000 00006', label: 'mobile' }] },
  { name: 'Priya', numbers: [{ number: '+91 90000 00007', label: 'mobile' }, { number: '9000000007', label: 'mobile' }] },
]

describe('planCall', () => {
  it('relations find the right contact', () => {
    expect(planCall('mom', undefined, contacts)).toMatchObject({ type: 'call', choice: { name: 'Mummy' }, sure: true })
    expect(planCall('dad', undefined, contacts)).toMatchObject({ type: 'call', choice: { name: 'Papa', label: 'mobile' } })
    expect(planCall('dad', 'work', contacts)).toMatchObject({ type: 'call', choice: { number: '0612 222222' } })
  })
  it('asks when several people match', () => {
    const p = planCall('rahul', undefined, contacts)
    expect(p.type).toBe('choose')
    expect(p.type === 'choose' && p.options.map((o) => o.name)).toEqual(['Rahul Sharma', 'Rahul Verma'])
  })
  it('a full name picks one person, preferring the mobile', () => {
    expect(planCall('rahul sharma', undefined, contacts)).toMatchObject({ type: 'call', choice: { label: 'mobile', number: '+91 90000 00003' } })
  })
  it('tolerates spelling from speech', () => {
    expect(planCall('raahul verma', undefined, contacts)).toMatchObject({ type: 'call', choice: { name: 'Rahul Verma' } })
    expect(planCall('shriya', undefined, contacts)).toMatchObject({ type: 'choose', reason: 'numbers' })
  })
  it('the same number saved twice is one number', () => {
    expect(planCall('priya', undefined, contacts)).toMatchObject({ type: 'call', choice: { name: 'Priya' } })
  })
  it('unknown names', () => {
    expect(planCall('zebra', undefined, contacts)).toEqual({ type: 'none' })
  })
})

describe('pickOption', () => {
  const labels = ['Client review', 'Meeting with Rahul', 'Gym']
  it('ordinals, names and "all"', () => {
    expect(pickOption('the second one', labels)).toBe(1)
    expect(pickOption('doosra wala', labels)).toBe(1)
    expect(pickOption('the last one', labels)).toBe(2)
    expect(pickOption('rahul', labels)).toBe(1)
    expect(pickOption('both of them', labels)).toBe('all')
    expect(pickOption('banana', labels)).toBe(-1)
  })
})

describe('autocorrect', () => {
  it('fixes common typos and mishearings', () => {
    expect(autocorrect('cancle my meating tomorow')).toBe('cancel my meeting tomorrow')
    expect(autocorrect('add to my calender')).toBe('add to my calendar')
    expect(autocorrect('set a remainder')).toBe('set a reminder')
    expect(autocorrect('re schedule it')).toBe('reschedule it')
    expect(autocorrect('at 5 p m')).toBe('at 5 pm')
    expect(autocorrect('appontment on wensday')).toBe('appointment on wednesday') // fuzzy + dictionary
  })
  it('leaves real words alone', () => {
    expect(autocorrect('cancer checkup')).toBe('cancer checkup')
    expect(autocorrect('ice melting experiment')).toBe('ice melting experiment')
    expect(autocorrect('scheduled reminders')).toBe('scheduled reminders')
  })
  it('spoken phone numbers', () => {
    expect(spokenNumber('nine eight seven six five four three two one zero')).toBe('9876543210')
    expect(spokenNumber('double nine triple eight 12345')).toBe('9988812345')
    expect(spokenNumber('plus 91 98765 43210')).toBe('+919876543210')
    expect(spokenNumber('rahul')).toBeNull()
  })
  it('phonetic keys', () => {
    expect(phonetic('Raahul')).toBe(phonetic('Rahul'))
    expect(phonetic('Vikas')).toBe(phonetic('Wikas'))
  })
})
