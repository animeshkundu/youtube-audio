/**
 * YouTube Audio Website - Main JavaScript
 */

document.addEventListener('DOMContentLoaded', function () {
  // Mobile menu toggle
  initMobileMenu();

  // FAQ accordion
  initFAQ();

  // Smooth scrolling for anchor links
  initSmoothScroll();

  // Navbar scroll effect
  initNavbarScroll();
});

/**
 * Initialize mobile menu toggle
 */
function initMobileMenu() {
  const menuBtn = document.getElementById('mobileMenuBtn');
  const navLinks = document.querySelector('.nav-links');

  if (!menuBtn || !navLinks) return;

  menuBtn.addEventListener('click', function () {
    menuBtn.classList.toggle('active');
    navLinks.classList.toggle('mobile-open');
  });
}

/**
 * Initialize FAQ accordion
 */
function initFAQ() {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(function (item) {
    const question = item.querySelector('.faq-question');

    if (!question) return;

    question.addEventListener('click', function () {
      // Close other items
      faqItems.forEach(function (otherItem) {
        if (otherItem !== item) {
          otherItem.classList.remove('active');
        }
      });

      // Toggle current item
      item.classList.toggle('active');
    });
  });
}

/**
 * Initialize smooth scrolling for anchor links
 */
function initSmoothScroll() {
  const anchors = document.querySelectorAll('a[href^="#"]');

  anchors.forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');

      if (href === '#') return;

      const target = document.querySelector(href);

      if (!target) return;

      e.preventDefault();

      const navHeight = document.querySelector('.navbar')?.offsetHeight || 0;
      const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navHeight;

      window.scrollTo({
        top: targetPosition,
        behavior: 'smooth',
      });
    });
  });
}

/**
 * Initialize navbar scroll effect
 */
function initNavbarScroll() {
  const navbar = document.getElementById('navbar');

  if (!navbar) return;

  let lastScroll = 0;

  window.addEventListener('scroll', function () {
    const currentScroll = window.pageYOffset;

    if (currentScroll > 100) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }

    lastScroll = currentScroll;
  });
}
