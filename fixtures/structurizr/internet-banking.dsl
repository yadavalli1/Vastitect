/*
 * Written for Vastitecture's tests. Exercises groups, hierarchical identifiers, constants,
 * deployment environments, dynamic views, styles and implicit relationships.
 */
workspace "Internet Banking" "A fictional bank's online channel." {

    !identifiers hierarchical
    !constant ORG "Example Bank"

    model {
        customer = person "Personal Banking Customer" "A customer of the bank, with personal bank accounts." "Customer"

        group "${ORG}" {
            supportStaff = person "Customer Service Staff" "Customer service staff within the bank." "Bank Staff"
            mainframe = softwareSystem "Mainframe Banking System" "Stores all of the core banking information." "Existing System"
            email = softwareSystem "E-mail System" "The internal e-mail system." "Existing System,External"

            banking = softwareSystem "Internet Banking System" "Lets customers view their accounts and make payments." {
                spa = container "Single-Page Application" "Provides internet banking functionality in the browser." "JavaScript and Angular" "Web Browser"
                web = container "Web Application" "Delivers the static content and the single-page application." "Java and Spring MVC"
                api = container "API Application" "Provides internet banking functionality via a JSON/HTTPS API." "Java and Spring MVC" {
                    signin = component "Sign In Controller" "Allows users to sign in." "Spring MVC Rest Controller"
                    accounts = component "Accounts Summary Controller" "Provides a summary of bank accounts." "Spring MVC Rest Controller"
                    security = component "Security Component" "Sign-in, password changes and so on." "Spring Bean"
                    facade = component "Mainframe Banking System Facade" "A facade onto the mainframe." "Spring Bean"
                    signin -> security "Uses"
                    accounts -> facade "Uses"
                }
                db = container "Database" "Stores user registration information and access logs." "Oracle Database Schema" "Database"
            }
        }

        customer -> banking.web "Visits bigbank.com using" "HTTPS"
        customer -> banking.spa "Views account balances using"
        customer -> supportStaff "Asks questions to" "Telephone"
        supportStaff -> mainframe "Uses"
        email -> customer "Sends e-mails to"
        banking.web -> banking.spa "Delivers to the customer's web browser"
        banking.spa -> banking.api.signin "Makes API calls to" "JSON/HTTPS"
        banking.spa -> banking.api.accounts "Makes API calls to" "JSON/HTTPS"
        banking.api.security -> banking.db "Reads from and writes to" "SQL/TCP"
        banking.api.facade -> mainframe "Makes API calls to" "XML/HTTPS"
        banking.api -> email "Sends e-mail using" "SMTP"

        deploymentEnvironment "Live" {
            deploymentNode "Customer's computer" "" "Microsoft Windows or Apple macOS" {
                deploymentNode "Web Browser" "" "Chrome, Firefox, Safari, or Edge" {
                    containerInstance banking.spa
                }
            }
            dc = deploymentNode "Example Bank data centre" "" "Private data centre" {
                deploymentNode "bank-web***" "" "Ubuntu 22.04 LTS" "" 4 {
                    containerInstance banking.web
                    containerInstance banking.api
                }
                deploymentNode "bank-db01" "" "Ubuntu 22.04 LTS" {
                    primary = deploymentNode "Oracle - Primary" "" "Oracle 19c" {
                        containerInstance banking.db
                    }
                }
                lb = infrastructureNode "Load balancer" "Distributes requests." "F5"
            }
        }
    }

    views {
        systemLandscape "SystemLandscape" {
            include *
            autoLayout
        }

        systemContext banking "SystemContext" {
            include *
            autoLayout
            description "The system context diagram for the Internet Banking System."
        }

        container banking "Containers" {
            include *
            autoLayout lr
        }

        component banking.api "Components" {
            include *
            autoLayout
        }

        dynamic banking.api "SignIn" "How sign-in works." {
            banking.spa -> banking.api.signin "Submits credentials to"
            banking.api.signin -> banking.api.security "Validates credentials using"
            banking.api.security -> banking.db "select * from users where username = ?"
            autoLayout lr
        }

        deployment banking "Live" "LiveDeployment" {
            include *
            autoLayout
        }

        styles {
            element "Person" {
                shape Person
            }
            element "Database" {
                shape Cylinder
            }
            element "Web Browser" {
                shape WebBrowser
            }
        }
    }
}
