Ext.define('PVE.ceph.Install', {
    extend: 'Ext.window.Window',
    xtype: 'pveCephInstallWindow',
    mixins: ['Proxmox.Mixin.CBind'],

    width: 220,
    header: false,
    resizable: false,
    draggable: false,
    modal: true,
    nodename: undefined,
    shadow: false,
    border: false,
    bodyBorder: false,
    closable: false,
    cls: 'install-mask',
    bodyCls: 'install-mask',
    layout: {
        align: 'stretch',
        pack: 'center',
        type: 'vbox',
    },
    viewModel: {
        data: {
            isInstalled: false,
        },
        formulas: {
            buttonText: function (get) {
                if (get('isInstalled')) {
                    return gettext('Configure Ceph');
                } else {
                    return gettext('Install Ceph');
                }
            },
            windowText: function (get) {
                if (get('isInstalled')) {
                    return `<p class="install-mask">
		    ${gettext('Ceph is not initialized.')}
		    ${gettext('You need to create an initial config once.')}</p>`;
                } else {
                    return (
                        '<p class="install-mask">' +
                        gettext('Ceph is not installed on this node.') +
                        '<br>' +
                        gettext('Would you like to install it now?') +
                        '</p>'
                    );
                }
            },
        },
    },
    items: [
        {
            bind: {
                html: '{windowText}',
            },
            border: false,
            padding: 5,
            bodyCls: 'install-mask',
        },
        {
            xtype: 'button',
            bind: {
                text: '{buttonText}',
            },
            viewModel: {},
            cbind: {
                nodename: '{nodename}',
            },
            handler: function () {
                let view = this.up('pveCephInstallWindow');
                let wizard = Ext.create('PVE.ceph.CephInstallWizard', {
                    nodename: view.nodename,
                });
                wizard.getViewModel().set('isInstalled', this.getViewModel().get('isInstalled'));
                wizard.show();
                view.mon(wizard, 'beforeClose', function () {
                    view.fireEvent('cephInstallWindowClosed');
                    view.close();
                });
            },
        },
    ],
});
