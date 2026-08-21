import { T } from '@galalem/react-localization'
import { Logo } from '~/components'


export function AuthPanel() {
  return (
    <aside
      className="bg-secondary d-flex flex-column justify-content-between position-relative overflow-hidden"
      style={{color: "#eaf0fa", padding: "clamp(36px, 4vw, 56px)"}}>
      <Logo className='align-self-start'/>

      <div className="auth-layout__hero">
        <h2 className="auth-layout__headline">
          <T>layouts.auth.headline</T>
        </h2>
        <ul className="auth-layout__points">
          <li>
            <span className="text-success fw-bold icon-rtl-flip">→</span>
            <T>layouts.auth.point_1</T>
          </li>
          <li>
            <span className="text-success fw-bold icon-rtl-flip">→</span>
            <T>layouts.auth.point_2</T>
          </li>
          <li>
            <span className="text-success fw-bold icon-rtl-flip">→</span>
            <T>layouts.auth.point_3</T>
          </li>
        </ul>
      </div>

      <div className="font-monospace" style={{
        fontSize: "11px",
        color: "#6c7a93",
        letterSpacing: "0.06em",
      }}>
        <T>layouts.auth.footer_tag</T>
      </div>
    </aside>
  )
}
