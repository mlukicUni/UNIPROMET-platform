Imports System
Imports System.Net
Imports System.Threading

''' <summary>
''' Siguran asinhroni webhook mehanizam koji obaveštava novi UNIPROMET ADMIN panel
''' o promenama u bazi bez blokiranja i bez ikakvog uticaja na rad starog sajta.
''' </summary>
Public Class UniprometWebhook

    ''' <summary>
    ''' Šalje asinhroni signal novom admin panelu.
    ''' Izvršava se u pozadinskom thread-u sa timeout-om od 1.5s i tihim hvatanjem svih grešaka.
    ''' </summary>
    Public Shared Sub NotifyChangeAsync()
        ThreadPool.QueueUserWorkItem(Sub(state)
            Try
                Dim targetUrl As String = "http://192.168.120.98:3080/api/equipment/webhook/legacy-change"
                Dim req As HttpWebRequest = CType(WebRequest.Create(targetUrl), HttpWebRequest)
                req.Method = "POST"
                req.Timeout = 1500
                req.ReadWriteTimeout = 1500
                req.ContentType = "application/json"
                req.ContentLength = 0

                Using resp As WebResponse = req.GetResponse()
                    ' Uspešno poslat signal
                End Using
            Catch ex As Exception
                ' Potpuna izolacija: ako je novi server ugašen ili nedostupan,
                ' stari sajt NEĆE prijaviti nikakvu grešku niti usporiti rad!
            End Try
        End Sub)
    End Sub

End Class
