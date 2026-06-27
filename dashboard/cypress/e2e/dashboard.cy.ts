describe('Dashboard E2E Tests', () => {
  it('should load the dashboard application successfully', () => {
    cy.visit('/');
    // Check that the body is visible
    cy.get('body').should('be.visible');
  });
});
