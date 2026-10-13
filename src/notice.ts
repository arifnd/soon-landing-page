/**
 * A user-facing message shown below the email form after a submission.
 */
export interface LandingNotice {
    type: 'success' | 'error';
    message: string;
}
