/**
 * Quiz Routes — receives quiz results from Shopify Liquid pages
 * and syncs them to the student's Manus profile.
 *
 * These endpoints are called from the modified Liquid templates
 * via JavaScript fetch() when a student completes a quiz.
 *
 * Supported quiz types:
 *   - eligibility  → /pages/eligibility
 *   - ikigai       → /pages/ikigai-quiz
 *   - finance      → /pages/finance-calculator
 */
const express = require('express');
const router = express.Router();
const manusApi = require('../services/manusApi');
const { optionalIntegrationToken } = require('../middleware/authToken');
const logger = require('../utils/logger');

// Optional auth — if the student is already logged in to Manus,
// we can link the quiz results directly to their account.
router.use(optionalIntegrationToken);

/**
 * POST /quiz/eligibility
 *
 * Receives eligibility quiz results from the Shopify Liquid page.
 */
router.post('/eligibility', async (req, res) => {
  try {
    const {
      firstName, lastName, email, phone, age,
      immigrationStatus, previousFunding, englishLevel,
      course, campus, eligible, source,
    } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    logger.info('Eligibility quiz submitted', { email, eligible, course, campus });

    const quizPayload = {
      type: 'eligibility',
      email: email.toLowerCase(),
      firstName,
      lastName,
      phone,
      results: {
        age,
        immigrationStatus,
        previousFunding,
        englishLevel,
        chosenCourse: course,
        chosenCampus: campus,
        isEligible: eligible !== false,
      },
      completedAt: new Date().toISOString(),
      source: source || 'shopify',
    };

    // If user is authenticated via Manus token, attach their user ID
    if (req.integrationUser) {
      quizPayload.manusUserId = req.integrationUser.userId;
    }

    const result = await manusApi.syncQuizResults(quizPayload);

    // Also upsert the student record
    await manusApi.upsertStudent({
      email: email.toLowerCase(),
      firstName,
      lastName,
      phone,
      source: 'eligibility_quiz',
    });

    res.json({
      success: true,
      message: 'Eligibility results synced',
      studentLinked: !!req.integrationUser,
    });

  } catch (err) {
    logger.error('Error processing eligibility quiz', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /quiz/ikigai
 *
 * Receives Ikigai quiz results from the Shopify Liquid page.
 */
router.post('/ikigai', async (req, res) => {
  try {
    const {
      name, email, phone,
      answers, topDomain, tagCounts,
      recommendedCourses, source,
    } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    logger.info('Ikigai quiz submitted', { email, topDomain });

    const quizPayload = {
      type: 'ikigai',
      email: email.toLowerCase(),
      firstName: name ? name.split(' ')[0] : undefined,
      lastName: name ? name.split(' ').slice(1).join(' ') : undefined,
      phone,
      results: {
        answers,
        topDomain,
        tagCounts,
        recommendedCourses: recommendedCourses || [],
      },
      completedAt: new Date().toISOString(),
      source: source || 'shopify',
    };

    if (req.integrationUser) {
      quizPayload.manusUserId = req.integrationUser.userId;
    }

    const result = await manusApi.syncQuizResults(quizPayload);

    await manusApi.upsertStudent({
      email: email.toLowerCase(),
      firstName: name ? name.split(' ')[0] : undefined,
      lastName: name ? name.split(' ').slice(1).join(' ') : undefined,
      phone,
      source: 'ikigai_quiz',
    });

    res.json({
      success: true,
      message: 'Ikigai results synced',
      studentLinked: !!req.integrationUser,
    });

  } catch (err) {
    logger.error('Error processing ikigai quiz', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /quiz/finance
 *
 * Receives finance calculator results from the Shopify Liquid page.
 */
router.post('/finance', async (req, res) => {
  try {
    const {
      email, livingLocation, courseDuration,
      expectedSalary, tuitionPerYear, maintenancePerYear,
      totalPerYear, totalCourse, monthlyRepayment, source,
    } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    logger.info('Finance calculator submitted', { email, livingLocation, expectedSalary });

    const quizPayload = {
      type: 'finance_calculator',
      email: email.toLowerCase(),
      results: {
        livingLocation,
        courseDuration,
        expectedSalary,
        tuitionPerYear,
        maintenancePerYear,
        totalPerYear,
        totalCourse,
        monthlyRepayment,
      },
      completedAt: new Date().toISOString(),
      source: source || 'shopify',
    };

    if (req.integrationUser) {
      quizPayload.manusUserId = req.integrationUser.userId;
    }

    await manusApi.syncQuizResults(quizPayload);

    res.json({
      success: true,
      message: 'Finance calculator results synced',
      studentLinked: !!req.integrationUser,
    });

  } catch (err) {
    logger.error('Error processing finance calculator', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
