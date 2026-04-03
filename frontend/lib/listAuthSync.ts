interface ListAuthResolutionState {
  hasResolvedBefore: boolean;
  previousAdminState: boolean | null;
  isAdmin: boolean;
  initialDataLoaded: boolean;
  initialIsAdmin: boolean;
}

export const shouldRefreshListAfterAuthResolution = ({
  hasResolvedBefore,
  previousAdminState,
  isAdmin,
  initialDataLoaded,
  initialIsAdmin,
}: ListAuthResolutionState): boolean => {
  if (!hasResolvedBefore) {
    if (!initialDataLoaded) {
      return isAdmin;
    }
    return initialIsAdmin !== isAdmin;
  }

  return previousAdminState !== isAdmin;
};
