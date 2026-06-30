# Firestore Security Specifications for Nightingale EduConnect

This specification documents the security invariants, access-control policies, and threat vectors for the EduConnect Firestore databases.

## 1. Data Invariants
1. **User Identity Isolation**: A user profile inside the `users` collection must match the `request.auth.uid`. Role assignment is immutable by the user once created.
2. **Access Derivation**: Permission to view individual student details (such as grades, EMIS information, attendance records, and health notifications) is strictly limited to authorized school staff (`teacher` or `admin`) and the specific `parent` matching the student's `parentEmail`.
3. **Emergency Alert Integrity**: Only authorized teachers or admins can post and modify `announcements` and `homework` files.
4. **Action-Based Buzz Feed Updates**: Parents can only modify `likes` and `likedBy` fields on `news` feed articles to express reactions.
5. **Call and Medical State Locking**: Parents can only mutate the `status` lifecycle fields on `calls` (to accept/decline) and `health_alerts` (to acknowledge/indicate they are on their way).

## 2. The "Dirty Dozen" Payloads (Threat Matrix)
These 12 JSON payloads describe malicious attempts to violate database security. The final rules must reject all of them with `PERMISSION_DENIED`.

### Payload 1: Role Escalation (Identity)
A registered Parent attempts to update their own `users` document to escalate their role to `admin`.
```json
// Collection: users/user_parent_123
// Requestor Auth UID: user_parent_123 (Parent role existing)
{
  "role": "admin"
}
```

### Payload 2: Profile Spoofing (Identity)
A user attempts to register or modify a profile for another user's UID.
```json
// Collection: users/victim_uid
// Requestor Auth UID: attacker_uid
{
  "uid": "victim_uid",
  "email": "victim@school.edu",
  "role": "parent",
  "name": "Attacker Mimic",
  "gradeClass": "I STD"
}
```

### Payload 3: Student Record Scraping (PII Leak)
An authenticated Parent attempts to query or read student information belonging to a different parent.
```json
// Collection: students/student_victim_99
// Requestor Auth UID: parent_attacker (Email: attacker@domain.com)
// Student record's parentEmail: victim@domain.com
{
  "id": "33020100101",
  "name": "Victim Child"
}
```

### Payload 4: Fake Rain Holiday Announcement (Integrity)
A malicious student or parent attempts to post an announcement declaring a fake Rain Holiday.
```json
// Collection: announcements/fake_holiday
// Requestor Auth UID: parent_uid
{
  "title": "SCHOOL HOLIDAY: Severe Torrential Rain Emergency",
  "content": "All classes suspended indefinitely. Enjoy the sleep!",
  "isRainHoliday": true,
  "date": "2026-06-29",
  "gradeClass": "All",
  "createdBy": "Faked Principal",
  "createdByEmail": "principal@school.edu",
  "createdAt": 1782724800000,
  "encrypted": false
}
```

### Payload 5: Grade Tampering (Integrity)
A parent or student attempts to update academic grades inside the student record.
```json
// Collection: students/student_id_1
// Requestor Auth UID: parent_uid
{
  "marks": {
    "Term 1": { "Mathematics": 100, "Tamil": 100 }
  }
}
```

### Payload 6: Homework Sabotage (Integrity)
A malicious user attempts to delete a homework assignment posted by a teacher.
```json
// Collection: homework/hw-1 (Delete operation)
// Requestor Auth UID: parent_uid
{}
```

### Payload 7: Practice Test Poisoning (Resource Exhaustion)
An attacker attempts to create a dummy Online Practice Test with an excessively large name to trigger database bloat.
```json
// Collection: tests/poison_test
// Requestor Auth UID: parent_uid
{
  "title": "A".repeat(500000), // 500KB string
  "subject": "Math",
  "gradeClass": "I STD",
  "durationMinutes": 30,
  "questions": [],
  "createdBy": "Spammer",
  "createdAt": 1782724800000
}
```

### Payload 8: Direct Grade Injection (State Shortcutting)
A student attempts to forge a test submission with a perfect score.
```json
// Collection: submissions/fake_sub
// Requestor Auth UID: student_parent_uid (Email: student@example.com)
// Submission specifies a different parentEmail to escape detection
{
  "testId": "test_math_1",
  "testTitle": "Math Addition",
  "studentName": "Emily Clark",
  "parentEmail": "another_parent@school.edu",
  "score": 10,
  "totalQuestions": 10,
  "timestamp": 1782724800000
}
```

### Payload 9: Buzz Feed Defacement (State Shortcutting)
A parent attempts to edit the text contents of a school buzz article.
```json
// Collection: news/article_1
// Requestor Auth UID: parent_uid
{
  "titleEn": "Defaced Article Title",
  "contentEn": "School is permanently closed."
}
```

### Payload 10: Call Signaling Hijack (Privacy Leak)
An unauthorized parent attempts to decline/end a virtual hot line call session intended for another parent.
```json
// Collection: calls/call_session_77
// Requestor Auth UID: attacker_parent (Email: hacker@example.com)
// Call session parentEmail: victim_parent@example.com
{
  "status": "declined"
}
```

### Payload 11: Medical Update Fraud (PII Leak)
An attacker tries to update the symptoms list of another child's medical health alert.
```json
// Collection: health_alerts/alert_abc
// Requestor Auth UID: attacker_parent (Email: hacker@example.com)
// Alert record's parentEmail: victim_parent@example.com
{
  "symptoms": ["Healthy", "FakeSymptom"]
}
```

### Payload 12: Unauthenticated Write (Identity)
An unauthenticated user attempts to create a profile or document.
```json
// Collection: users/anonymous_user (Create operation)
// Requestor Auth: null
{
  "uid": "anonymous_user",
  "email": "anonymous@school.edu",
  "role": "parent",
  "name": "Ghost",
  "gradeClass": "I STD"
}
```

## 3. Test Runner Design
A test suite (e.g. `firestore.rules.test.ts`) verifies these invariants by asserting `assertFails` on all "Dirty Dozen" payloads while confirming `assertSucceeds` for valid teacher/parent interactions.
