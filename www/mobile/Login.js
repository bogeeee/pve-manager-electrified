Ext.define('PVE.Login', {
    extend: 'Ext.form.Panel',
    alias: "widget.pveLogin",

    handleTFA: function(username, ticketResponse) {
	let me = this;
	let errlabel = me.down('#signInFailedLabel');

	// set auth cookie with half-loggedin ticket for TFA
	ticketResponse.LoggedOut = true;
	Proxmox.Utils.setAuthData(ticketResponse);

	if (Ext.isDefined(ticketResponse.U2FChallenge)) {
	    Ext.Msg.show({
		title: 'Error - U2F not implemented',
		message: 'The U2F two factor authentication is not yet implemented on mobile.',
		buttons: Ext.MessageBox.CANCEL,
	    });
	    errlabel.show();
	} else {
	    Ext.Msg.show({
		title: 'Two-Factor Authentication',
		message: 'Please enter your OTP verification code:',
		buttons: Ext.MessageBox.OKCANCEL,
		prompt: {
		    xtype: 'tfacode',
		},
		fn: function(buttonId, code) {
		    if (buttonId === "cancel") {
			Proxmox.LoggedOut = false;
			Proxmox.Utils.authClear();
		    } else {
			me.mask({
			    xtype: 'loadmask',
			    message: 'Loading...',
			});
			Proxmox.Utils.API2Request({
			    url: '/api2/extjs/access/ticket',
			    params: {
				username: ticketResponse.username,
				'tfa-challenge': ticketResponse.ticket,
				password: `totp:${code}`
			    },
			    method: 'POST',
			    timeout: 5000, // it'll delay both success & failure
			    success: function(resp, opts) {
				me.unmask();
				// Fill in what we copy over from the 1st factor:
				let authdata = resp.result.data;
				authdata.CSRFPreventionToken = Proxmox.CSRFPreventionToken;
				authdata.username = username;
				// Finish login, sets real cookie and loads page
				PVE.Workspace.updateLoginData(authdata);
			    },
			    failure: function(resp, opts) {
				me.unmask();
				Proxmox.Utils.authClear();
				errlabel.show();
			    },
			});
		    }
		},
	    });
	}
    },

    config: {
	title: 'Login',
	padding: 10,
	appUrl: 'login',
	items: [
	    {
		xtype: 'image',
		src: '/pve2/images/pve-electrified_logo_30x172.png',
		height: 30,
		width: 209,
	    },
	    {
	        xtype: 'fieldset',
	        title: 'Proxmox VE Login',
	        items: [
	            {
	                xtype: 'textfield',
	                placeHolder: gettext('User name'),
	                itemId: 'userNameTextField',
	                name: 'username',
	                required: true,
	            },
	            {
	                xtype: 'passwordfield',
	                placeHolder: gettext('Password'),
	                itemId: 'passwordTextField',
	                name: 'password',
	                required: true,
	            },
		    {
			xtype: 'pveRealmSelector',
	                itemId: 'realmSelectorField',
			name: 'realm',
		    },
	        ],
	    },
	    {
	        xtype: 'label',
                html: 'Login failed. Please enter the correct credentials.',
	        itemId: 'signInFailedLabel',
	        hidden: true,
	        hideAnimation: 'fadeOut',
	        showAnimation: 'fadeIn',
	        style: 'color:#990000;margin:5px 0px;',
	    },
	    {
	        xtype: 'button',
	        itemId: 'logInButton',
	        ui: 'action',
	        text: 'Log In',
		handler: function() {
		    var form = this.up('formpanel');

		    var usernameField = form.down('#userNameTextField'),
	                passwordField = form.down('#passwordTextField'),
		        realmField = form.down('#realmSelectorField'),
		        errlabel = form.down('#signInFailedLabel');

		    errlabel.hide();

		    var username = usernameField.getValue();
	            var password = passwordField.getValue();
	            var realm = realmField.getValue();

		    Proxmox.Utils.API2Request({
			url: '/access/ticket',
			method: 'POST',
			waitMsgTarget: form,
			params: { username: username, password: password, realm: realm },
			failure: function(response, options) {
			    errlabel.show();
			},
			success: function(response, options) {
			    passwordField.setValue('');

			    let data = response.result.data;
			    if (Ext.isDefined(data.NeedTFA)) {
				form.handleTFA(username, data);
			    } else {
				PVE.Workspace.updateLoginData(data);
			    }
			},
		    });
		},
	    },
	],
    },
});

Ext.define('PVE.field.TFACode', {
    extend: 'Ext.field.Text',
    xtype: 'tfacode',

    config: {
	component: {
	    type: 'number',
	},
	maxLength: 6,
	required: true,
    },
});
