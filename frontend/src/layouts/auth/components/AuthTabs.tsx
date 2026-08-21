import { T } from '@galalem/react-localization'
import { NavLink } from '@galalem/react-router'

export function AuthTabs() {
  return (
    <nav className="auth-tabs">
      <NavLink to="/login" className="auth-tabs__tab" activeClassName="active">
        <T>common.auth.login</T>
      </NavLink>
      <NavLink to="/signup" className="auth-tabs__tab" activeClassName="active">
        <T>common.auth.signup</T>
      </NavLink>
      <NavLink to="/forgot-password" className={({isActive}) => `auth-tabs__tab ${isActive ? 'active' : 'd-none'}`}>
        <T>common.auth.forgot_password</T>
      </NavLink>
      <NavLink to="/reset-password" className={({isActive}) => `auth-tabs__tab ${isActive ? 'active' : 'd-none'}`}>
        <T>common.auth.reset_password</T>
      </NavLink>
      <NavLink to="/verify-email" className={({isActive}) => `auth-tabs__tab ${isActive ? 'active' : 'd-none'}`}>
        <T>common.auth.verify_email</T>
      </NavLink>
    </nav>
  )
}
