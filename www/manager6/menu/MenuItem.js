Ext.define('PVE.menu.Item', {
    extend: 'Ext.menu.Item',
    alias: 'widget.pveMenuItem',

    // set to wrap the handler callback in a confirm dialog  showing this text
    confirmMsg: false,

    // set to focus 'No' instead of 'Yes' button and show a warning symbol
    dangerous: false,

    initComponent: function () {
        let me = this;
        if (me.handler) {
            me.setHandler(me.handler, me.scope);
        }
        me.callParent();
    },

    setHandler: function (fn, scope) {
        let me = this;
        me.scope = scope;
        me.handler = function (button, e) {
            if (me.confirmMsg) {
                Ext.MessageBox.defaultButton = me.dangerous ? 2 : 1;
                Ext.Msg.show({
                    title: gettext('Confirm'),
                    icon: me.dangerous ? Ext.Msg.WARNING : Ext.Msg.QUESTION,
                    msg: me.confirmMsg,
                    buttons: Ext.Msg.YESNO,
                    defaultFocus: me.dangerous ? 'no' : 'yes',
                    callback: function (btn) {
                        if (btn === 'yes') {
                            Ext.callback(fn, me.scope, [me, e], 0, me);
                        }
                    },
                });
            } else {
                Ext.callback(fn, me.scope, [me, e], 0, me);
            }
        };
    },
});
