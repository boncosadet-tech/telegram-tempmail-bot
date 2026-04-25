import 'package:flutter_email_sender/flutter_email_sender.dart';

class EmailComposeService {
  const EmailComposeService();

  Future<void> compose({
    List<String> recipients = const <String>[],
    String subject = '',
    String body = '',
    List<String> cc = const <String>[],
    List<String> bcc = const <String>[],
    bool isHTML = false,
  }) async {
    final email = Email(
      recipients: recipients,
      subject: subject,
      body: body,
      cc: cc,
      bcc: bcc,
      isHTML: isHTML,
    );
    await FlutterEmailSender.send(email);
  }

  Future<void> reply({
    required String to,
    required String subject,
    String body = '',
  }) async {
    final replySubject = subject.startsWith('Re: ') ? subject : 'Re: $subject';
    await compose(
      recipients: <String>[to],
      subject: replySubject,
      body: body,
    );
  }

  Future<void> forward({
    required String subject,
    required String body,
    List<String> recipients = const <String>[],
  }) async {
    final fwdSubject = subject.startsWith('Fwd: ') ? subject : 'Fwd: $subject';
    await compose(
      recipients: recipients,
      subject: fwdSubject,
      body: body,
    );
  }
}
