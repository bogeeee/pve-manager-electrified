Ext.define('PVE.ha.RuleErrorsModal', {
    extend: 'Ext.window.Window',
    alias: ['widget.pveHARulesErrorsModal'],
    mixins: ['Proxmox.Mixin.CBind'],

    modal: true,
    scrollable: true,
    resizable: false,

    title: gettext('HA rule errors'),

    initComponent: function () {
        let me = this;

        let renderHARuleErrors = (errors) => {
            if (!errors) {
                return gettext('The HA rule has no errors.');
            }

            let errorListItemsHtml = '';

            for (let [opt, messages] of Object.entries(errors)) {
                errorListItemsHtml += messages
                    .map((message) => `<li>${Ext.htmlEncode(`${opt}: ${message}`)}</li>`)
                    .join('');
            }

            return `<div>
		    <p>${gettext('The HA rule has the following errors:')}</p>
		    <ul>${errorListItemsHtml}</ul>
		</div>`;
        };

        Ext.apply(me, {
            modal: true,
            border: false,
            layout: 'fit',
            items: [
                {
                    xtype: 'displayfield',
                    padding: 20,
                    scrollable: true,
                    value: renderHARuleErrors(me.errors),
                },
            ],
        });

        me.callParent();
    },
});
